use anyhow::Result;
use clap::Subcommand;

#[derive(Subcommand)]
pub enum SpecCommands {
    /// List saved spec artifacts
    List(crate::commands::spec_artifact::ListSpecsArgs),
    /// Get a saved spec artifact
    Get(crate::commands::spec_artifact::GetSpecArgs),
    /// Save a repo spec file as a MultiSoul artifact snapshot
    Save(crate::commands::spec_artifact::SaveSpecArgs),
    /// Delete a saved spec artifact
    Delete(crate::commands::spec_artifact::DeleteSpecArgs),
    /// Start implementation for a saved spec artifact
    Implement(crate::commands::spec_artifact::ImplementSpecArgs),
    /// Mark a spec artifact as implementation complete
    MarkDone(crate::commands::spec_artifact::MarkSpecDoneArgs),
    /// Dispatch a JSON spec body to an agent
    Dispatch(crate::commands::spec_dispatch::DispatchSpecArgs),
    /// Manage Ideas to Specs source ideas
    Idea {
        #[command(subcommand)]
        subcommand: crate::commands::spec_idea::SpecIdeaCommands,
    },
}

pub fn handle(cmd: SpecCommands) -> Result<()> {
    match cmd {
        SpecCommands::List(args) => crate::commands::spec_artifact::list(args),
        SpecCommands::Get(args) => crate::commands::spec_artifact::get(args),
        SpecCommands::Save(args) => crate::commands::spec_artifact::save(args),
        SpecCommands::Delete(args) => crate::commands::spec_artifact::delete(args),
        SpecCommands::Implement(args) => crate::commands::spec_artifact::implement(args),
        SpecCommands::MarkDone(args) => crate::commands::spec_artifact::mark_done(args),
        SpecCommands::Dispatch(args) => crate::commands::spec_dispatch::handle(args),
        SpecCommands::Idea { subcommand } => crate::commands::spec_idea::handle(subcommand),
    }
}

#[cfg(test)]
#[path = "../../tests/commands/spec_commands_tests.rs"]
mod tests;
