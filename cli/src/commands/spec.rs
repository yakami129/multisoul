use anyhow::Result;
use clap::Subcommand;

#[derive(Subcommand)]
pub enum SpecCommands {
    /// Save a repo spec file as a MultiSoul artifact snapshot
    Save(crate::commands::save_spec::SaveSpecArgs),
    /// Mark a spec artifact as implementation complete
    MarkDone(crate::commands::mark_spec_done::MarkSpecDoneArgs),
}

pub fn handle(cmd: SpecCommands) -> Result<()> {
    match cmd {
        SpecCommands::Save(args) => crate::commands::save_spec::handle(args),
        SpecCommands::MarkDone(args) => crate::commands::mark_spec_done::handle(args),
    }
}

#[cfg(test)]
#[path = "../../tests/commands/spec_commands_tests.rs"]
mod tests;
