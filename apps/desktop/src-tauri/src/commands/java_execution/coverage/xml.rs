//! Import JaCoCo measurements without deriving coverage from test outcomes or source text.
use super::{Counter, Counters, CoverageFile, CoverageLine};
use quick_xml::{
    events::{BytesStart, Event},
    Reader,
};
use std::collections::{BTreeMap, BTreeSet};
fn attributes(
    reader: &Reader<&[u8]>,
    element: &BytesStart<'_>,
) -> Result<BTreeMap<String, String>, String> {
    let mut result = BTreeMap::new();
    for attribute in element.attributes() {
        let attribute = attribute.map_err(|_| "Malformed coverage attributes.")?;
        let key = std::str::from_utf8(attribute.key.as_ref())
            .map_err(|_| "Coverage attributes are not UTF-8.")?;
        let value = attribute
            .decode_and_unescape_value(reader.decoder())
            .map_err(|_| "Malformed coverage attribute text.")?
            .into_owned();
        if value.len() > 4096 || result.insert(key.into(), value).is_some() {
            return Err("Coverage attributes exceed their bounds or are duplicated.".into());
        }
    }
    Ok(result)
}
fn number(attributes: &BTreeMap<String, String>, name: &str) -> Result<u32, String> {
    let text = attributes
        .get(name)
        .ok_or("A coverage number is missing.")?;
    if text.is_empty() || !text.bytes().all(|b| b.is_ascii_digit()) {
        return Err("Invalid coverage number.".into());
    }
    text.parse::<u32>()
        .ok()
        .filter(|n| *n <= 1_000_000_000)
        .ok_or_else(|| "Coverage number exceeds its bounds.".into())
}
fn name(attributes: &BTreeMap<String, String>, key: &str, empty: bool) -> Result<String, String> {
    let value = attributes.get(key).ok_or("A coverage name is missing.")?;
    if (!empty && value.is_empty())
        || value.len() > 1024
        || value.chars().any(char::is_control)
        || value.contains('\\')
        || value.starts_with('/')
        || value
            .split('/')
            .any(|part| part == "." || part == ".." || (part.is_empty() && !empty))
    {
        return Err("Invalid coverage name.".into());
    }
    Ok(value.clone())
}
fn counter(
    destination: &mut Counters,
    attributes: &BTreeMap<String, String>,
    seen: &mut BTreeSet<String>,
) -> Result<(), String> {
    let kind = attributes
        .get("type")
        .ok_or("Coverage counter type is missing.")?;
    if ![
        "INSTRUCTION",
        "BRANCH",
        "LINE",
        "COMPLEXITY",
        "METHOD",
        "CLASS",
    ]
    .contains(&kind.as_str())
        || !seen.insert(kind.clone())
    {
        return Err("Coverage counter type is invalid or duplicated.".into());
    }
    let value = Counter {
        missed: number(attributes, "missed")?,
        covered: number(attributes, "covered")?,
    };
    match kind.as_str() {
        "INSTRUCTION" => destination.instructions = value,
        "BRANCH" => destination.branches = value,
        "LINE" => destination.lines = value,
        _ => {}
    }
    Ok(())
}
pub(super) fn parse(
    bytes: &[u8],
    path: &str,
    session: &str,
) -> Result<(Counters, Vec<CoverageFile>), String> {
    std::str::from_utf8(bytes).map_err(|_| "Coverage report is not UTF-8.")?;
    let mut reader = Reader::from_reader(bytes);
    reader.config_mut().trim_text(true);
    let mut stack: Vec<String> = Vec::new();
    let mut files = Vec::new();
    let mut package = String::new();
    let mut source: Option<CoverageFile> = None;
    let mut source_seen = BTreeSet::new();
    let mut source_lines = BTreeSet::new();
    let mut report_seen = BTreeSet::new();
    let mut file_ids = BTreeSet::new();
    let mut counters = Counters::default();
    let mut correlated = false;
    let mut closed = false;
    let mut line_count = 0;
    loop {
        let event = reader.read_event().map_err(|_| "Malformed coverage XML.")?;
        match event {
            Event::Start(ref element) | Event::Empty(ref element) => {
                let tag = std::str::from_utf8(element.name().as_ref())
                    .map_err(|_| "Invalid coverage tag.")?
                    .to_owned();
                let parent = stack.last().map(String::as_str);
                if stack.is_empty() && (tag != "report" || closed) {
                    return Err("Coverage XML needs one report root.".into());
                }
                if stack.len() >= 32 {
                    return Err("Coverage XML nesting exceeds its limit.".into());
                }
                let values = attributes(&reader, element)?;
                match tag.as_str() {
                    "report" if stack.is_empty() => {
                        name(&values, "name", true)?;
                    }
                    "package" if parent == Some("report") => {
                        package = name(&values, "name", true)?;
                        if package.split('/').any(|part| part.is_empty()) && !package.is_empty() {
                            return Err("Invalid coverage package path.".into());
                        }
                    }
                    "sourcefile" if parent == Some("package") => {
                        if source.is_some() || files.len() >= super::MAX_FILES {
                            return Err("Coverage source files exceed their limit.".into());
                        }
                        let file_name = name(&values, "name", false)?;
                        if file_name.contains('/') {
                            return Err("Coverage source filename is not a component.".into());
                        }
                        let id = format!("{path}:{package}/{file_name}");
                        if !file_ids.insert(id.clone()) {
                            return Err("Coverage source file is duplicated.".into());
                        }
                        source = Some(CoverageFile {
                            id,
                            report_path: path.into(),
                            module_root: None,
                            package_name: package.clone(),
                            name: file_name,
                            counters: Counters::default(),
                            lines: Vec::new(),
                        });
                        source_seen.clear();
                        source_lines.clear();
                    }
                    "sessioninfo" if parent == Some("report") => {
                        if values.get("id").is_some_and(|value| value == session) {
                            correlated = true;
                        }
                    }
                    "line" if parent == Some("sourcefile") => {
                        line_count += 1;
                        if line_count > super::MAX_LINES {
                            return Err("Coverage lines exceed their limit.".into());
                        }
                        let number = number(&values, "nr")?;
                        let line = CoverageLine {
                            number,
                            missed_instructions: number_value(&values, "mi")?,
                            covered_instructions: number_value(&values, "ci")?,
                            missed_branches: number_value(&values, "mb")?,
                            covered_branches: number_value(&values, "cb")?,
                        };
                        if number == 0
                            || !source_lines.insert(number)
                            || line.missed_instructions as u64 + line.covered_instructions as u64
                                == 0
                        {
                            return Err("Coverage line is invalid or duplicated.".into());
                        }
                        source
                            .as_mut()
                            .ok_or("Coverage line has no source.")?
                            .lines
                            .push(line);
                    }
                    "counter" if parent == Some("sourcefile") => counter(
                        &mut source
                            .as_mut()
                            .ok_or("Coverage counter has no source.")?
                            .counters,
                        &values,
                        &mut source_seen,
                    )?,
                    "counter" if parent == Some("report") => {
                        counter(&mut counters, &values, &mut report_seen)?
                    }
                    "class" if parent == Some("package") => {}
                    "method" if parent == Some("class") => {}
                    "counter" if matches!(parent, Some("method" | "class" | "package")) => {}
                    _ => return Err("Unexpected coverage XML structure.".into()),
                }
                if matches!(event, Event::Start(_)) {
                    stack.push(tag);
                } else {
                    if tag == "sourcefile" {
                        finish_source(&mut source, &mut files)?;
                    }
                    if tag == "report" {
                        closed = true;
                    }
                }
            }
            Event::End(ref element) => {
                let tag = std::str::from_utf8(element.name().as_ref())
                    .map_err(|_| "Invalid coverage close tag.")?
                    .to_owned();
                if stack.pop().as_deref() != Some(&tag) {
                    return Err("Coverage tags do not match.".into());
                }
                if tag == "sourcefile" {
                    finish_source(&mut source, &mut files)?;
                }
                if tag == "report" {
                    closed = true;
                }
            }
            Event::DocType(ref value) => {
                let text = std::str::from_utf8(value.as_ref())
                    .map_err(|_| "Invalid coverage document type.")?;
                if text.split_whitespace().collect::<Vec<_>>().join(" ")
                    != "report PUBLIC \"-//JACOCO//DTD Report 1.1//EN\" \"report.dtd\""
                {
                    return Err(
                        "Coverage XML document type is not the standard JaCoCo declaration.".into(),
                    );
                }
            }
            Event::Text(ref value) => {
                if !value.iter().all(u8::is_ascii_whitespace) {
                    return Err("Unexpected coverage text.".into());
                }
            }
            Event::Decl(_) | Event::Comment(_) => {}
            Event::Eof => break,
            _ => return Err("Unsupported coverage XML content.".into()),
        }
    }
    if !closed || !stack.is_empty() || !correlated {
        return Err("Coverage report is incomplete or belongs to another execution.".into());
    }
    if counters.instructions.covered as u64 + counters.instructions.missed as u64 == 0 {
        return Err("JaCoCo reported no executable production code in this scope.".into());
    }
    let mut source_totals = Counters::default();
    for file in &files {
        source_totals.add(&file.counters)?;
    }
    for (source, reported) in [
        (&source_totals.instructions, &counters.instructions),
        (&source_totals.branches, &counters.branches),
        (&source_totals.lines, &counters.lines),
    ] {
        if source.missed > reported.missed || source.covered > reported.covered {
            return Err("Coverage totals disagree with their source measurements.".into());
        }
    }
    files.sort_by(|a, b| a.id.cmp(&b.id));
    Ok((counters, files))
}
fn number_value(attributes: &BTreeMap<String, String>, key: &str) -> Result<u32, String> {
    number(attributes, key)
}
fn finish_source(
    source: &mut Option<CoverageFile>,
    files: &mut Vec<CoverageFile>,
) -> Result<(), String> {
    let mut file = source
        .take()
        .ok_or("Coverage source closing tag has no file.")?;
    let covered = file
        .lines
        .iter()
        .filter(|line| line.covered_instructions > 0)
        .count() as u32;
    let missed = file.lines.len() as u32 - covered;
    if file.counters.lines.covered != covered || file.counters.lines.missed != missed {
        return Err("Coverage source-line counters disagree with their measurements.".into());
    }
    file.lines.sort_by_key(|line| line.number);
    files.push(file);
    Ok(())
}
