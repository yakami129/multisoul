use clap::{Parser, Subcommand};

mod commands;
mod config;
mod db;
#[cfg(test)]
#[path = "../tests/src/db_workflows_tests.rs"]
mod db_workflows_tests;
mod logging;
mod serve;

#[derive(Parser)]
#[command(name = "msctl", version, about = "MultiSoul Agent CLI")]
struct Cli {
    #[command(subcommand)]
    command: Commands,

    /// Log level for `msctl serve` (trace/debug/info/warn/error). Ignored by other subcommands.
    #[arg(long, global = true, default_value = logging::DEFAULT_LEVEL)]
    log_level: String,
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
    /// Push a question card to the local serve server
    AskQuestion(commands::ask_question::AskQuestionArgs),
    /// Spec artifact commands
    Spec {
        #[command(subcommand)]
        subcommand: commands::spec::SpecCommands,
    },
    /// Manage msctl as a background service
    Daemon {
        #[command(subcommand)]
        subcommand: commands::daemon::DaemonCommands,
    },
    /// Inspect local app and service logs
    Logs(commands::logs::LogsArgs),
}

fn main() -> anyhow::Result<()> {
    let cli = Cli::parse();
    match cli.command {
        Commands::Auth { subcommand } => commands::auth::handle(subcommand),
        Commands::Agent { subcommand } => commands::agent::handle(subcommand),
        Commands::Serve(args) => {
            let log_dir = logging::default_log_dir()?;
            // Hold the guard for the duration of main; dropping it flushes the appender.
            let _guard = logging::init_subscriber(logging::Config {
                log_dir,
                level: cli.log_level,
            })?;
            tokio::runtime::Runtime::new()?.block_on(commands::serve::handle(args))
        }
        Commands::AskQuestion(args) => commands::ask_question::handle(args),
        Commands::Spec { subcommand } => commands::spec::handle(subcommand),
        Commands::Daemon { subcommand } => commands::daemon::handle(subcommand),
        Commands::Logs(args) => commands::logs::handle(args),
    }
}
