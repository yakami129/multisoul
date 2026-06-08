use chrono::{Datelike, Duration, Local, NaiveTime, TimeZone, Timelike};

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum WorkflowScheduleKind {
    Daily,
    Weekly,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct WorkflowScheduleSpec {
    pub kind: WorkflowScheduleKind,
    pub time_of_day: String,
    pub day_of_week: Option<u32>,
}

pub fn validate_workflow_input(
    name: &str,
    prompt: &str,
    spec: &WorkflowScheduleSpec,
) -> Result<(), String> {
    if name.trim().is_empty() {
        return Err("workflow name is required".to_string());
    }
    if prompt.trim().is_empty() {
        return Err("workflow prompt is required".to_string());
    }
    parse_time_of_day(&spec.time_of_day)?;
    match spec.kind {
        WorkflowScheduleKind::Daily => {
            if spec.day_of_week.is_some() {
                return Err("daily schedule must not include day_of_week".to_string());
            }
        }
        WorkflowScheduleKind::Weekly => match spec.day_of_week {
            Some(1..=7) => {}
            _ => return Err("weekly schedule requires day_of_week 1..=7".to_string()),
        },
    }
    Ok(())
}

pub fn next_run_after_ms(spec: &WorkflowScheduleSpec, now_ms: i64) -> Result<i64, String> {
    let time = parse_time_of_day(&spec.time_of_day)?;
    let now = Local
        .timestamp_millis_opt(now_ms)
        .single()
        .ok_or_else(|| "now_ms cannot be represented in local timezone".to_string())?;

    match spec.kind {
        WorkflowScheduleKind::Daily => next_daily_run_ms(now_ms, time, now),
        WorkflowScheduleKind::Weekly => next_weekly_run_ms(spec, now_ms, time, now),
    }
}

pub(super) fn schedule_kind_from_str(value: &str) -> Result<WorkflowScheduleKind, String> {
    match value {
        "daily" => Ok(WorkflowScheduleKind::Daily),
        "weekly" => Ok(WorkflowScheduleKind::Weekly),
        _ => Err("schedule_kind must be daily or weekly".to_string()),
    }
}

fn next_daily_run_ms(
    now_ms: i64,
    time: NaiveTime,
    now: chrono::DateTime<Local>,
) -> Result<i64, String> {
    let mut candidate = local_datetime_ms(
        now.year(),
        now.month(),
        now.day(),
        time.hour(),
        time.minute(),
    )?;
    if candidate <= now_ms {
        let tomorrow = now.date_naive() + Duration::days(1);
        candidate = local_datetime_ms(
            tomorrow.year(),
            tomorrow.month(),
            tomorrow.day(),
            time.hour(),
            time.minute(),
        )?;
    }
    Ok(candidate)
}

fn next_weekly_run_ms(
    spec: &WorkflowScheduleSpec,
    now_ms: i64,
    time: NaiveTime,
    now: chrono::DateTime<Local>,
) -> Result<i64, String> {
    let target = spec
        .day_of_week
        .filter(|day| (1..=7).contains(day))
        .ok_or_else(|| "weekly schedule requires day_of_week 1..=7".to_string())?;
    let today = now.weekday().number_from_monday();
    let mut days_until = (target + 7 - today) % 7;
    let mut target_date = now.date_naive() + Duration::days(days_until as i64);
    let mut candidate = local_datetime_ms(
        target_date.year(),
        target_date.month(),
        target_date.day(),
        time.hour(),
        time.minute(),
    )?;
    if candidate <= now_ms {
        days_until += 7;
        target_date = now.date_naive() + Duration::days(days_until as i64);
        candidate = local_datetime_ms(
            target_date.year(),
            target_date.month(),
            target_date.day(),
            time.hour(),
            time.minute(),
        )?;
    }
    Ok(candidate)
}

fn parse_time_of_day(value: &str) -> Result<NaiveTime, String> {
    NaiveTime::parse_from_str(value, "%H:%M").map_err(|_| "time_of_day must be HH:mm".to_string())
}

fn local_datetime_ms(
    year: i32,
    month: u32,
    day: u32,
    hour: u32,
    minute: u32,
) -> Result<i64, String> {
    Local
        .with_ymd_and_hms(year, month, day, hour, minute, 0)
        .single()
        .map(|dt| dt.timestamp_millis())
        .ok_or_else(|| "local schedule time is ambiguous or invalid".to_string())
}
