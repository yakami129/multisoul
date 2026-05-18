use std::{
    process::Command,
    time::{Duration, Instant},
};

pub fn wait_until(timeout: Duration, mut condition: impl FnMut() -> bool) -> bool {
    let start = Instant::now();
    while start.elapsed() < timeout {
        if condition() {
            return true;
        }
        std::thread::sleep(Duration::from_millis(50));
    }
    condition()
}

pub fn join_with_timeout<T>(
    handle: std::thread::JoinHandle<T>,
    timeout: Duration,
) -> Option<std::thread::Result<T>> {
    let start = Instant::now();
    while start.elapsed() < timeout {
        if handle.is_finished() {
            return Some(handle.join());
        }
        std::thread::sleep(Duration::from_millis(50));
    }
    None
}

pub fn process_exists(pid: u32) -> bool {
    #[cfg(unix)]
    {
        // SAFETY: kill(pid, 0) only checks whether the pid exists; it does not send a signal.
        unsafe { libc::kill(pid as libc::pid_t, 0) == 0 }
    }
    #[cfg(windows)]
    {
        use windows_sys::Win32::Foundation::CloseHandle;
        use windows_sys::Win32::System::Threading::{
            OpenProcess, PROCESS_QUERY_LIMITED_INFORMATION,
        };

        unsafe {
            let h = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid);
            if h.is_null() {
                return false;
            }
            CloseHandle(h);
            true
        }
    }
    #[cfg(not(any(unix, windows)))]
    {
        let _ = pid;
        false
    }
}

pub trait StartNewProcessGroupForTest {
    fn tap_start_new_process_group(&mut self) -> &mut Self;
}

impl StartNewProcessGroupForTest for Command {
    fn tap_start_new_process_group(&mut self) -> &mut Self {
        crate::serve::state::start_new_process_group(self);
        self
    }
}
