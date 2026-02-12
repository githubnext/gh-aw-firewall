//! One-Shot Token LD_PRELOAD Library
//!
//! Intercepts getenv() calls for sensitive token environment variables.
//! On first access, returns the real value and immediately unsets the variable.
//! Subsequent calls return NULL, preventing token reuse by malicious code.
//!
//! Configuration:
//!   AWF_ONE_SHOT_TOKENS - Comma-separated list of token names to protect
//!   If not set, uses built-in defaults
//!
//! Compile: cargo build --release
//! Usage: LD_PRELOAD=/path/to/libone_shot_token.so ./your-program

use libc::{c_char, c_void};
use once_cell::sync::Lazy;
use std::collections::HashSet;
use std::ffi::{CStr, CString};
use std::ptr;
use std::sync::Mutex;

/// Maximum number of tokens we can track
const MAX_TOKENS: usize = 100;

/// Default sensitive token environment variable names
const DEFAULT_SENSITIVE_TOKENS: &[&str] = &[
    // GitHub tokens
    "COPILOT_GITHUB_TOKEN",
    "GITHUB_TOKEN",
    "GH_TOKEN",
    "GITHUB_API_TOKEN",
    "GITHUB_PAT",
    "GH_ACCESS_TOKEN",
    // OpenAI tokens
    "OPENAI_API_KEY",
    "OPENAI_KEY",
    // Anthropic/Claude tokens
    "ANTHROPIC_API_KEY",
    "CLAUDE_API_KEY",
    // Codex tokens
    "CODEX_API_KEY",
];

/// State for tracking tokens and their access status
struct TokenState {
    /// List of sensitive token names to protect
    tokens: Vec<String>,
    /// Set of tokens that have already been accessed
    accessed: HashSet<String>,
    /// Whether initialization has completed
    initialized: bool,
    /// Leaked CStrings that must persist for the lifetime of the process
    /// (returned pointers must remain valid for callers)
    leaked_strings: Vec<*mut c_char>,
}

// SAFETY: TokenState is only accessed through a Mutex, ensuring thread safety
unsafe impl Send for TokenState {}
unsafe impl Sync for TokenState {}

impl TokenState {
    fn new() -> Self {
        Self {
            tokens: Vec::new(),
            accessed: HashSet::new(),
            initialized: false,
            leaked_strings: Vec::new(),
        }
    }
}

/// Global state protected by a mutex
static STATE: Lazy<Mutex<TokenState>> = Lazy::new(|| Mutex::new(TokenState::new()));

/// Type alias for the real getenv function
type GetenvFn = unsafe extern "C" fn(*const c_char) -> *mut c_char;

/// Cached pointer to the real getenv function
static REAL_GETENV: Lazy<GetenvFn> = Lazy::new(|| {
    // SAFETY: We're looking up a standard C library function
    unsafe {
        let symbol = libc::dlsym(libc::RTLD_NEXT, c"getenv".as_ptr());
        if symbol.is_null() {
            eprintln!("[one-shot-token] FATAL: Could not find real getenv");
            std::process::abort();
        }
        std::mem::transmute::<*mut c_void, GetenvFn>(symbol)
    }
});

/// Cached pointer to the real secure_getenv function (may be null if unavailable)
static REAL_SECURE_GETENV: Lazy<Option<GetenvFn>> = Lazy::new(|| {
    // SAFETY: We're looking up a standard C library function
    unsafe {
        let symbol = libc::dlsym(libc::RTLD_NEXT, c"secure_getenv".as_ptr());
        if symbol.is_null() {
            eprintln!("[one-shot-token] WARNING: secure_getenv not available, falling back to getenv");
            None
        } else {
            Some(std::mem::transmute::<*mut c_void, GetenvFn>(symbol))
        }
    }
});

/// Call the real getenv function
///
/// # Safety
/// The `name` parameter must be a valid null-terminated C string
unsafe fn call_real_getenv(name: *const c_char) -> *mut c_char {
    (*REAL_GETENV)(name)
}

/// Call the real secure_getenv function, falling back to getenv if unavailable
///
/// # Safety
/// The `name` parameter must be a valid null-terminated C string
unsafe fn call_real_secure_getenv(name: *const c_char) -> *mut c_char {
    match *REAL_SECURE_GETENV {
        Some(func) => func(name),
        None => call_real_getenv(name),
    }
}

/// Initialize the token list from AWF_ONE_SHOT_TOKENS or defaults
///
/// # Safety
/// Must be called with STATE lock held
fn init_token_list(state: &mut TokenState) {
    if state.initialized {
        return;
    }

    // Get configuration from environment
    let config_cstr = CString::new("AWF_ONE_SHOT_TOKENS").unwrap();
    // SAFETY: We're calling the real getenv with a valid C string
    let config_ptr = unsafe { call_real_getenv(config_cstr.as_ptr()) };

    if !config_ptr.is_null() {
        // SAFETY: config_ptr is valid if not null
        let config = unsafe { CStr::from_ptr(config_ptr) };
        if let Ok(config_str) = config.to_str() {
            if !config_str.is_empty() {
                // Parse comma-separated token list
                for token in config_str.split(',') {
                    let token = token.trim();
                    if !token.is_empty() && state.tokens.len() < MAX_TOKENS {
                        state.tokens.push(token.to_string());
                    }
                }

                if !state.tokens.is_empty() {
                    eprintln!(
                        "[one-shot-token] Initialized with {} custom token(s) from AWF_ONE_SHOT_TOKENS",
                        state.tokens.len()
                    );
                    state.initialized = true;
                    return;
                }

                // Config was set but parsed to zero tokens - fall back to defaults
                eprintln!("[one-shot-token] WARNING: AWF_ONE_SHOT_TOKENS was set but parsed to zero tokens");
                eprintln!("[one-shot-token] WARNING: Falling back to default token list to maintain protection");
            }
        }
    }

    // Use default token list
    for token in DEFAULT_SENSITIVE_TOKENS {
        if state.tokens.len() >= MAX_TOKENS {
            break;
        }
        state.tokens.push((*token).to_string());
    }

    eprintln!(
        "[one-shot-token] Initialized with {} default token(s)",
        state.tokens.len()
    );
    state.initialized = true;
}

/// Check if a token name is sensitive and return whether it's been accessed
fn is_sensitive_token(state: &TokenState, name: &str) -> bool {
    state.tokens.iter().any(|t| t == name)
}

/// Core implementation for one-shot token access
///
/// # Safety
/// - `name` must be a valid null-terminated C string
/// - `real_getenv_fn` must be a valid function to call for getting the real value
unsafe fn handle_getenv_impl(
    name: *const c_char,
    real_getenv_fn: unsafe fn(*const c_char) -> *mut c_char,
    via_secure: bool,
) -> *mut c_char {
    // Null name - pass through
    if name.is_null() {
        return real_getenv_fn(name);
    }

    // Convert name to Rust string for comparison
    let name_cstr = CStr::from_ptr(name);
    let name_str = match name_cstr.to_str() {
        Ok(s) => s,
        Err(_) => return real_getenv_fn(name),
    };

    // Lock state and ensure initialization
    let mut state = match STATE.lock() {
        Ok(guard) => guard,
        Err(poisoned) => poisoned.into_inner(),
    };

    if !state.initialized {
        init_token_list(&mut state);
    }

    // Check if this is a sensitive token
    if !is_sensitive_token(&state, name_str) {
        // Not sensitive - pass through (drop lock first for performance)
        drop(state);
        return real_getenv_fn(name);
    }

    // Sensitive token - handle one-shot access
    if state.accessed.contains(name_str) {
        // Already accessed - return NULL
        return ptr::null_mut();
    }

    // First access - get the real value
    let result = real_getenv_fn(name);

    if result.is_null() {
        // Token not set - mark as accessed to prevent repeated log messages
        state.accessed.insert(name_str.to_string());
        return ptr::null_mut();
    }

    // Copy the value before unsetting
    let value_cstr = CStr::from_ptr(result);
    let value_bytes = value_cstr.to_bytes_with_nul();
    
    // Allocate memory that will never be freed (must persist for caller's use)
    let leaked = libc::malloc(value_bytes.len()) as *mut c_char;
    if leaked.is_null() {
        eprintln!("[one-shot-token] ERROR: Failed to allocate memory for token value");
        std::process::abort();
    }
    
    // Copy the value
    ptr::copy_nonoverlapping(value_bytes.as_ptr(), leaked as *mut u8, value_bytes.len());
    
    // Track the leaked pointer (for documentation purposes - we never free it)
    state.leaked_strings.push(leaked);

    // Unset the environment variable
    libc::unsetenv(name);

    let suffix = if via_secure { " (via secure_getenv)" } else { "" };
    eprintln!(
        "[one-shot-token] Token {} accessed and cleared{}",
        name_str, suffix
    );

    // Mark as accessed
    state.accessed.insert(name_str.to_string());

    leaked
}

/// Intercepted getenv function
///
/// For sensitive tokens:
/// - First call: returns the real value, then unsets the variable
/// - Subsequent calls: returns NULL
///
/// For all other variables: passes through to real getenv
///
/// # Safety
/// This function is called from C code and must maintain C ABI compatibility.
/// The `name` parameter must be a valid null-terminated C string.
#[no_mangle]
pub unsafe extern "C" fn getenv(name: *const c_char) -> *mut c_char {
    handle_getenv_impl(name, call_real_getenv, false)
}

/// Intercepted secure_getenv function
///
/// This function preserves secure_getenv semantics (returns NULL in privileged contexts)
/// while applying the same one-shot token protection as getenv.
///
/// For sensitive tokens:
/// - First call: returns the real value (if not in privileged context), then unsets the variable
/// - Subsequent calls: returns NULL
///
/// For all other variables: passes through to real secure_getenv (or getenv if unavailable)
///
/// # Safety
/// This function is called from C code and must maintain C ABI compatibility.
/// The `name` parameter must be a valid null-terminated C string.
#[no_mangle]
pub unsafe extern "C" fn secure_getenv(name: *const c_char) -> *mut c_char {
    handle_getenv_impl(name, call_real_secure_getenv, true)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_default_tokens_defined() {
        assert!(!DEFAULT_SENSITIVE_TOKENS.is_empty());
        assert!(DEFAULT_SENSITIVE_TOKENS.contains(&"GITHUB_TOKEN"));
        assert!(DEFAULT_SENSITIVE_TOKENS.contains(&"OPENAI_API_KEY"));
    }

    #[test]
    fn test_token_state_new() {
        let state = TokenState::new();
        assert!(state.tokens.is_empty());
        assert!(state.accessed.is_empty());
        assert!(!state.initialized);
    }
}
