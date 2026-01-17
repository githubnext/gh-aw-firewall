/**
 * Seccomp Profile Validation Tests
 *
 * These tests verify the seccomp profile configuration:
 * - Profile uses deny-by-default approach (SCMP_ACT_ERRNO as defaultAction)
 * - Required syscalls for normal operation are allowed
 * - Dangerous syscalls are explicitly blocked
 */

import * as fs from 'fs';
import * as path from 'path';

describe('Seccomp Profile Validation', () => {
  interface SeccompRule {
    names: string[];
    action: string;
    errnoRet?: number;
    comment?: string;
  }

  interface SeccompProfile {
    defaultAction: string;
    defaultErrnoRet?: number;
    architectures: string[];
    syscalls: SeccompRule[];
  }

  let profile: SeccompProfile;

  beforeAll(() => {
    const profilePath = path.join(__dirname, '../containers/agent/seccomp-profile.json');
    const content = fs.readFileSync(profilePath, 'utf-8');
    profile = JSON.parse(content);
  });

  describe('Profile Structure', () => {
    test('should use deny-by-default approach', () => {
      expect(profile.defaultAction).toBe('SCMP_ACT_ERRNO');
      expect(profile.defaultErrnoRet).toBe(1);
    });

    test('should support required architectures', () => {
      expect(profile.architectures).toContain('SCMP_ARCH_X86_64');
      expect(profile.architectures).toContain('SCMP_ARCH_AARCH64');
    });

    test('should have valid syscall rules', () => {
      expect(profile.syscalls).toBeDefined();
      expect(Array.isArray(profile.syscalls)).toBe(true);
      expect(profile.syscalls.length).toBeGreaterThan(0);
    });
  });

  describe('Allowed Syscalls', () => {
    let allowedSyscalls: string[];

    beforeAll(() => {
      allowedSyscalls = profile.syscalls
        .filter(rule => rule.action === 'SCMP_ACT_ALLOW')
        .flatMap(rule => rule.names);
    });

    test('should allow basic file I/O syscalls', () => {
      const fileIOSyscalls = [
        'read', 'write', 'open', 'openat', 'close', 'stat', 'fstat', 'lstat',
        'lseek', 'mmap', 'mprotect', 'munmap', 'brk'
      ];
      fileIOSyscalls.forEach(syscall => {
        expect(allowedSyscalls).toContain(syscall);
      });
    });

    test('should allow networking syscalls for curl/git/npm', () => {
      const networkSyscalls = [
        'socket', 'connect', 'accept', 'accept4', 'bind', 'listen',
        'send', 'sendto', 'sendmsg', 'recv', 'recvfrom', 'recvmsg',
        'getsockopt', 'setsockopt', 'getsockname', 'getpeername'
      ];
      networkSyscalls.forEach(syscall => {
        expect(allowedSyscalls).toContain(syscall);
      });
    });

    test('should allow process management syscalls for Node.js', () => {
      const processSyscalls = [
        'fork', 'vfork', 'clone', 'clone3', 'execve', 'wait4', 'waitid',
        'exit', 'exit_group', 'kill', 'getpid', 'getppid'
      ];
      processSyscalls.forEach(syscall => {
        expect(allowedSyscalls).toContain(syscall);
      });
    });

    test('should allow signal handling syscalls', () => {
      const signalSyscalls = [
        'rt_sigaction', 'rt_sigprocmask', 'rt_sigreturn', 'sigaltstack'
      ];
      signalSyscalls.forEach(syscall => {
        expect(allowedSyscalls).toContain(syscall);
      });
    });

    test('should allow epoll/poll syscalls for async I/O', () => {
      const pollSyscalls = [
        'epoll_create', 'epoll_create1', 'epoll_ctl', 'epoll_wait', 'epoll_pwait',
        'poll', 'ppoll', 'select', 'pselect6'
      ];
      pollSyscalls.forEach(syscall => {
        expect(allowedSyscalls).toContain(syscall);
      });
    });

    test('should allow directory operations for git', () => {
      const dirSyscalls = [
        'mkdir', 'mkdirat', 'rmdir', 'rename', 'renameat', 'renameat2',
        'getcwd', 'chdir', 'getdents', 'getdents64'
      ];
      dirSyscalls.forEach(syscall => {
        expect(allowedSyscalls).toContain(syscall);
      });
    });

    test('should allow time-related syscalls', () => {
      const timeSyscalls = [
        'clock_gettime', 'clock_getres', 'gettimeofday', 'nanosleep', 'time'
      ];
      timeSyscalls.forEach(syscall => {
        expect(allowedSyscalls).toContain(syscall);
      });
    });

    test('should allow ioctl for terminal and device operations', () => {
      expect(allowedSyscalls).toContain('ioctl');
    });
  });

  describe('Denied Syscalls (Explicitly Blocked)', () => {
    let deniedSyscalls: string[];

    beforeAll(() => {
      deniedSyscalls = profile.syscalls
        .filter(rule => rule.action === 'SCMP_ACT_ERRNO')
        .flatMap(rule => rule.names);
    });

    test('should explicitly block process inspection syscalls (container escape vector)', () => {
      const ptraceSyscalls = ['ptrace', 'process_vm_readv', 'process_vm_writev'];
      ptraceSyscalls.forEach(syscall => {
        expect(deniedSyscalls).toContain(syscall);
      });
    });

    test('should explicitly block kernel execution syscalls (host compromise)', () => {
      const kernelSyscalls = ['kexec_load', 'kexec_file_load', 'reboot'];
      kernelSyscalls.forEach(syscall => {
        expect(deniedSyscalls).toContain(syscall);
      });
    });

    test('should explicitly block kernel module syscalls (rootkit installation)', () => {
      const moduleSyscalls = ['init_module', 'finit_module', 'delete_module'];
      moduleSyscalls.forEach(syscall => {
        expect(deniedSyscalls).toContain(syscall);
      });
    });

    test('should explicitly block mount syscalls (container escape)', () => {
      const mountSyscalls = ['mount', 'umount', 'umount2', 'pivot_root'];
      mountSyscalls.forEach(syscall => {
        expect(deniedSyscalls).toContain(syscall);
      });
    });

    test('should explicitly block namespace manipulation syscalls (container escape)', () => {
      const namespaceSyscalls = ['unshare', 'setns'];
      namespaceSyscalls.forEach(syscall => {
        expect(deniedSyscalls).toContain(syscall);
      });
    });

    test('should explicitly block BPF/perf syscalls (kernel exploitation)', () => {
      const bpfSyscalls = ['bpf', 'perf_event_open'];
      bpfSyscalls.forEach(syscall => {
        expect(deniedSyscalls).toContain(syscall);
      });
    });

    test('should explicitly block kernel keyring syscalls (credential theft)', () => {
      const keyringySyscalls = ['add_key', 'request_key', 'keyctl'];
      keyringySyscalls.forEach(syscall => {
        expect(deniedSyscalls).toContain(syscall);
      });
    });

    test('should explicitly block raw I/O syscalls (hardware exploitation)', () => {
      const rawioSyscalls = ['ioperm', 'iopl'];
      rawioSyscalls.forEach(syscall => {
        expect(deniedSyscalls).toContain(syscall);
      });
    });

    test('should explicitly block chroot syscall (container escape)', () => {
      expect(deniedSyscalls).toContain('chroot');
    });
  });

  describe('Security Properties', () => {
    test('should have more allowed syscalls than denied (comprehensive allowlist)', () => {
      const allowedCount = profile.syscalls
        .filter(rule => rule.action === 'SCMP_ACT_ALLOW')
        .reduce((sum, rule) => sum + rule.names.length, 0);
      
      const deniedCount = profile.syscalls
        .filter(rule => rule.action === 'SCMP_ACT_ERRNO')
        .reduce((sum, rule) => sum + rule.names.length, 0);

      // With deny-by-default, we need more allowed syscalls than explicitly denied
      expect(allowedCount).toBeGreaterThan(deniedCount);
      // Ensure we have a reasonable number of allowed syscalls for functionality
      expect(allowedCount).toBeGreaterThan(200);
    });

    test('all denied rules should have errnoRet set', () => {
      const deniedRules = profile.syscalls.filter(rule => rule.action === 'SCMP_ACT_ERRNO');
      deniedRules.forEach(rule => {
        expect(rule.errnoRet).toBeDefined();
        expect(rule.errnoRet).toBe(1); // EPERM
      });
    });

    test('all denied rules should have descriptive comments', () => {
      const deniedRules = profile.syscalls.filter(rule => rule.action === 'SCMP_ACT_ERRNO');
      deniedRules.forEach(rule => {
        expect(rule.comment).toBeDefined();
        expect(rule.comment!.length).toBeGreaterThan(10);
      });
    });
  });
});
