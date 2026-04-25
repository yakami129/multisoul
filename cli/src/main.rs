use clap::{Parser, Subcommand};

mod config;
mod commands;

#[derive(Parser)]
#[command(name = "msctl", version, about = "MultiSoul Agent CLI")]
struct Cli {
    #[command(subcommand)]
    command: Commands,
}

#[derive(Subcommand)]
enum Commands {
    /// Authentication commands
    Auth {
        #[command(subcommand)]
        subcommand: commands::auth::AuthCommands,
    },
    /// Agent management commands
    Agent {
        #[command(subcommand)]
        subcommand: commands::agent::AgentCommands,
    },
}

fn main() -> anyhow::Result<()> {
    let cli = Cli::parse();
    match cli.command {
        Commands::Auth { subcommand } => commands::auth::handle(subcommand),
        Commands::Agent { subcommand } => commands::agent::handle(subcommand),
    }
}
