use clap::{Parser, Subcommand};

mod config;
mod db;
mod commands;
mod serve;

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
    /// Start the local serve server
    Serve(commands::serve::ServeArgs),
}

fn main() -> anyhow::Result<()> {
    let cli = Cli::parse();
    match cli.command {
        Commands::Auth { subcommand } => commands::auth::handle(subcommand),
        Commands::Agent { subcommand } => commands::agent::handle(subcommand),
        Commands::Serve(args) => {
            tokio::runtime::Runtime::new()?.block_on(commands::serve::handle(args))
        }
    }
}
