use portable_pty::CommandBuilder;

// Profiles are loaded by PowerShell before this command. Call their prompt
// first so it sees the preceding command's $? and LASTEXITCODE unchanged.
#[cfg(any(windows, test))]
const POWERSHELL_PROMPT: &str = r#"
$global:__CubicleOriginalPrompt = (Get-Item Function:\prompt).ScriptBlock
function global:prompt {
    $cubiclePrompt = & $global:__CubicleOriginalPrompt
    try {
        $cubicleLocation = $ExecutionContext.SessionState.Path.CurrentLocation
        if ($cubicleLocation.Provider.Name -eq 'FileSystem') {
            $cubicleUri = [System.Uri]::new($cubicleLocation.Path)
            [Console]::Write([char]27 + ']7;' + $cubicleUri.AbsoluteUri + [char]7)
        }
    } catch {}
    $cubiclePrompt
}
"#;

/// Add session-local directory reporting after applying the user's environment.
/// No shell profile, startup file, or persistent environment is changed.
pub fn configure(command: &mut CommandBuilder, shell: &str) {
    #[cfg(windows)]
    configure_windows(command, shell);
    #[cfg(not(windows))]
    let _ = (command, shell);
}

#[cfg(any(windows, test))]
fn configure_windows(command: &mut CommandBuilder, shell: &str) {
    let name = shell.rsplit(['\\', '/']).next().unwrap_or(shell);
    if ["powershell", "powershell.exe", "pwsh", "pwsh.exe"]
        .iter()
        .any(|candidate| name.eq_ignore_ascii_case(candidate))
    {
        command.arg("-NoExit");
        command.arg("-Command");
        command.arg(POWERSHELL_PROMPT);
    } else if name.eq_ignore_ascii_case("cmd") || name.eq_ignore_ascii_case("cmd.exe") {
        // cmd cannot URI-encode $P. OSC 9;9 carries its raw Windows path, so
        // directories containing spaces, #, and % remain unambiguous.
        let previous = command
            .get_env("PROMPT")
            .map(|value| value.to_os_string())
            .or_else(|| std::env::var_os("PROMPT"))
            .unwrap_or_else(|| "$P$G".into());
        let mut prompt = std::ffi::OsString::from(r"$E]9;9;$P$E\");
        prompt.push(previous);
        command.env("PROMPT", prompt);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn powershell_loads_profiles_and_wraps_the_existing_prompt() {
        for shell in [
            "powershell.exe",
            "pwsh",
            r"C:\Program Files\PowerShell\7\pwsh.EXE",
        ] {
            let mut command = CommandBuilder::new(shell);
            command.env("CUSTOM_SETTING", "preserved");
            configure_windows(&mut command, shell);
            let args = command.get_argv();
            assert_eq!(args.len(), 4);
            assert_eq!(args[1], "-NoExit");
            assert_eq!(args[2], "-Command");
            assert_eq!(args[3], POWERSHELL_PROMPT);
            assert_eq!(command.get_env("CUSTOM_SETTING").as_deref(), Some(std::ffi::OsStr::new("preserved")));
            assert!(POWERSHELL_PROMPT.contains("$cubiclePrompt = & $global:__CubicleOriginalPrompt"));
            assert!(POWERSHELL_PROMPT.contains("$cubicleUri.AbsoluteUri"));
        }
    }

    #[test]
    fn cmd_preserves_an_explicit_prompt_and_reports_the_raw_directory() {
        let mut command = CommandBuilder::new("cmd.exe");
        command.env("PROMPT", "My prompt: $P$G");
        configure_windows(&mut command, "cmd.exe");
        assert_eq!(
            command.get_env("PROMPT").as_deref(),
            Some(std::ffi::OsStr::new(r"$E]9;9;$P$E\My prompt: $P$G"))
        );
        assert_eq!(command.get_argv().len(), 1);
    }

    #[test]
    fn unrelated_shells_are_not_modified() {
        let mut command = CommandBuilder::new("custom-shell.exe");
        configure_windows(&mut command, "custom-shell.exe");
        assert_eq!(command.get_argv().len(), 1);
    }

    #[cfg(windows)]
    #[test]
    fn powershell_reports_escaped_directories_and_preserves_prompt_status() {
        let folder = tempfile::tempdir().unwrap();
        let directory = folder.path().join("space # 100%");
        std::fs::create_dir(&directory).unwrap();
        let literal = directory.to_string_lossy().replace('\'', "''");
        let script = format!(
            r#"
function global:prompt {{ 'Original:' + [string]$? + ':' + $global:LASTEXITCODE }}
{POWERSHELL_PROMPT}
Set-Location -LiteralPath '{literal}'
$global:LASTEXITCODE = 23
Write-Error test -ErrorAction SilentlyContinue
prompt
if ($global:LASTEXITCODE -ne 23) {{ exit 1 }}
"#
        );
        let output = std::process::Command::new("powershell.exe")
            .args(["-NoProfile", "-NonInteractive", "-Command", &script])
            .output()
            .unwrap();
        assert!(output.status.success());
        let stdout = String::from_utf8_lossy(&output.stdout);
        assert!(stdout.contains("\u{1b}]7;file:///"));
        assert!(stdout.contains("space%20%23%20100%25"));
        assert!(stdout.contains("Original:False:23"));
    }
}
