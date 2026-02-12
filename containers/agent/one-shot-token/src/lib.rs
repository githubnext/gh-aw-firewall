//! One-Shot Token LD_PRELOAD Library
//!
//! Intercepts getenv() calls for sensitive token environment variables.
//! On first access, caches the value in memory and unsets from environment.
//! Subsequent calls return the cached value, so the process can read tokens
//! multiple times while /proc/self/environ no longer exposes them.
//!
//! Configuration:
//!   AWF_ONE_SHOT_TOKENS - Comma-separated list of token names to protect
//!   If not set, uses built-in defaults
//!
//! Compile: cargo build --release
//! Usage: LD_PRELOAD=/path/to/libone_shot_token.so ./your-program

use libc::{c_char, c_void};
use once_cell::sync::Lazy;
use std::collections::HashMap;
use std::ffi::{CStr, CString};
use std::ptr;
use std::sync::Mutex;

// External declaration of the environ pointer
// This is a POSIX standard global that points to the process's environment
extern "C" {
    static mut environ: *mut *mut c_char;
}

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

/// State for tracking tokens and their cached values
struct TokenState {
    /// List of sensitive token names to protect
    tokens: Vec<String>,
    /// Cached token values - stored on first access so subsequent reads succeed
    /// even after the variable is unset from the environment. This allows
    /// /proc/self/environ to be cleaned while the process can still read tokens.
    /// Maps token name to cached C string pointer (or null if token was not set).
    cache: HashMap<String, *mut c_char>,
    /// Whether initialization has completed
    initialized: bool,
}

// SAFETY: TokenState is only accessed through a Mutex, ensuring thread safety
unsafe impl Send for TokenState {}
unsafe impl Sync for TokenState {}

impl TokenState {
    fn new() -> Self {
        Self {
            tokens: Vec::new(),
            cache: HashMap::new(),
            initialized: false,
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

/// Check if a token name is sensitive
fn is_sensitive_token(state: &TokenState, name: &str) -> bool {
    state.tokens.iter().any(|t| t == name)
}

/// Format token value for logging: show first 4 characters + "..."
fn format_token_value(value: &str) -> String {
    if value.is_empty() {
        return "(empty)".to_string();
    }
    
    if value.len() <= 4 {
        format!("{}...", value)
    } else {
        format!("{}...", &value[..4])
    }
}

/// Check if a token still exists in the process environment
/// 
/// This function verifies whether unsetenv() successfully cleared the token
/// by directly checking the process's environ pointer. This works correctly
/// in both chroot and non-chroot modes (reading /proc/self/environ fails in
/// chroot because it shows the host's procfs, not the chrooted process's state).
fn check_task_environ_exposure(token_name: &str) {
    // SAFETY: environ is a standard POSIX global that points to the process's environment.
    // It's safe to read as long as we don't hold references across modifications.
    // We're only reading it after unsetenv() has completed, so the pointer is stable.
    unsafe {
        let mut env_ptr = environ;
        if env_ptr.is_null() {
            eprintln!("[one-shot-token] INFO: Token {} cleared (environ is null)", token_name);
            return;
        }
        
        // Iterate through environment variables
        let token_prefix = format!("{}=", token_name);
        let token_prefix_bytes = token_prefix.as_bytes();
        
        while !(*env_ptr).is_null() {
            let env_cstr = CStr::from_ptr(*env_ptr);
            let env_bytes = env_cstr.to_bytes();
            
            // Check if this entry starts with our token name
            if env_bytes.len() >= token_prefix_bytes.len() 
                && &env_bytes[..token_prefix_bytes.len()] == token_prefix_bytes {
                eprintln!(
                    "[one-shot-token] WARNING: Token {} still exposed in process environment",
                    token_name
                );
                return;
            }
            
            env_ptr = env_ptr.add(1);
        }
        
        // Token not found in environment - success!
        eprintln!(
            "[one-shot-token] INFO: Token {} cleared from process environment",
            token_name
        );
    }
}

/// Core implementation for cached token access
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

    // Sensitive token - check if already cached
    if let Some(&cached_ptr) = state.cache.get(name_str) {
        // Already accessed - return cached value (may be null if token wasn't set)
        return cached_ptr;
    }

    // First access - get the real value and cache it
    let result = real_getenv_fn(name);

    if result.is_null() {
        // Token not set - cache null to prevent repeated log messages
        state.cache.insert(name_str.to_string(), ptr::null_mut());
        return ptr::null_mut();
    }

    // Copy the value before unsetting
    let value_cstr = CStr::from_ptr(result);
    let value_str = value_cstr.to_str().unwrap_or("");
    let value_bytes = value_cstr.to_bytes_with_nul();
    
    // Allocate memory that will never be freed (must persist for caller's use)
    let cached = libc::malloc(value_bytes.len()) as *mut c_char;
    if cached.is_null() {
        eprintln!("[one-shot-token] ERROR: Failed to allocate memory for token value");
        std::process::abort();
    }
    
    // Copy the value
    ptr::copy_nonoverlapping(value_bytes.as_ptr(), cached as *mut u8, value_bytes.len());
    
    // Cache the pointer so subsequent reads return the same value
    state.cache.insert(name_str.to_string(), cached);

    // Unset the environment variable so it's no longer accessible
    libc::unsetenv(name);

    // Verify the token was cleared from the process environment
    check_task_environ_exposure(name_str);

    let suffix = if via_secure { " (via secure_getenv)" } else { "" };
    eprintln!(
        "[one-shot-token] Token {} accessed and cached (value: {}){}",
        name_str, format_token_value(value_str), suffix
    );

    cached
}

/// Intercepted getenv function
///
/// For sensitive tokens:
/// - First call: caches the value, unsets from environment, returns cached value
/// - Subsequent calls: returns the cached value from memory
///
/// This clears tokens from /proc/self/environ while allowing the process
/// to read them multiple times via getenv().
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
/// while applying the same cached token protection as getenv.
///
/// For sensitive tokens:
/// - First call: caches the value, unsets from environment, returns cached value
/// - Subsequent calls: returns the cached value from memory
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
        assert!(state.cache.is_empty());
        assert!(!state.initialized);
    }

    #[test]
    fn test_format_token_value() {
        assert_eq!(format_token_value(""), "(empty)");
        assert_eq!(format_token_value("ab"), "ab...");
        assert_eq!(format_token_value("abcd"), "abcd...");
        assert_eq!(format_token_value("abcde"), "abcd...");
        assert_eq!(format_token_value("ghp_1234567890"), "ghp_...");
    }
}
