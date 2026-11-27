//! Three way merge of project JSON: what this computer changed since both sides last
//! agreed (`base` -> `ours`) applied onto the shared state (`theirs`).
//!
//! The local agent is a whole document, so a local save can carry old values of parts
//! someone else changed meanwhile. Sending it as is would put those old values back.
//! Merging it against the last agreed state first keeps only what changed here.

use serde_json::{Map, Value};

/// `theirs` with the changes from `base` to `ours`.
pub fn merge3(base: &Value, ours: &Value, theirs: &Value) -> Value {
    if ours == base {
        return theirs.clone();
    }
    if theirs == base || theirs == ours {
        return ours.clone();
    }
    match (base, ours, theirs) {
        (Value::Object(b), Value::Object(o), Value::Object(t)) => Value::Object(merge_objects(b, o, t)),
        // No agreed state yet (or another shape): merge as if both started empty.
        (_, Value::Object(o), Value::Object(t)) => Value::Object(merge_objects(&Map::new(), o, t)),
        (Value::Array(b), Value::Array(o), Value::Array(t)) => match identity_key(&[b, o, t]) {
            Some(key) => Value::Array(merge_lists(b, o, t, key)),
            None => ours.clone(),
        },
        // Both changed the same value: this computer's edit is the newer one it knows of.
        _ => ours.clone(),
    }
}

fn merge_objects(
    base: &Map<String, Value>,
    ours: &Map<String, Value>,
    theirs: &Map<String, Value>,
) -> Map<String, Value> {
    let mut merged = Map::new();
    let mut keys: Vec<&String> = theirs.keys().collect();
    keys.extend(ours.keys().filter(|k| !theirs.contains_key(*k)));
    for key in keys {
        let (b, o, t) = (base.get(key), ours.get(key), theirs.get(key));
        let value = match (b, o, t) {
            (_, Some(o), Some(t)) => Some(merge3(b.unwrap_or(&Value::Null), o, t)),
            // Removed here: removed, unless the other side changed it since.
            (Some(b), None, Some(t)) => (t != b).then(|| t.clone()),
            // Added here.
            (None, Some(o), None) => Some(o.clone()),
            // Removed there: removed, unless changed here since.
            (Some(b), Some(o), None) => (o != b).then(|| o.clone()),
            (_, None, Some(t)) => Some(t.clone()),
            _ => None,
        };
        if let Some(value) = value {
            merged.insert(key.clone(), value);
        }
    }
    merged
}

/// `id`, else `name`, when every item of every list is an object with a distinct string under it.
fn identity_key(lists: &[&Vec<Value>]) -> Option<&'static str> {
    ["id", "name"].into_iter().find(|key| {
        lists.iter().all(|list| {
            let mut seen = std::collections::HashSet::new();
            list.iter().all(|item| item.get(*key).and_then(Value::as_str).is_some_and(|id| seen.insert(id.to_owned())))
        })
    })
}

fn merge_lists(base: &[Value], ours: &[Value], theirs: &[Value], key: &str) -> Vec<Value> {
    let id = |item: &Value| item.get(key).and_then(Value::as_str).unwrap_or("").to_owned();
    let find = |list: &[Value], wanted: &str| list.iter().find(|item| id(item) == wanted).cloned();
    let mut merged: Vec<Value> = Vec::new();
    for item in theirs {
        let item_id = id(item);
        match (find(base, &item_id), find(ours, &item_id)) {
            // Removed here (and not changed there since): drop it.
            (Some(b), None) if b == *item => {}
            (Some(_), None) => merged.push(item.clone()),
            (b, Some(o)) => merged.push(merge3(b.as_ref().unwrap_or(&Value::Null), &o, item)),
            (None, None) => merged.push(item.clone()),
        }
    }
    // Added here: after the item that precedes it here.
    for (index, item) in ours.iter().enumerate() {
        let item_id = id(item);
        if find(base, &item_id).is_some() || merged.iter().any(|m| id(m) == item_id) {
            continue;
        }
        let after = ours.get(..index).and_then(|before| {
            before.iter().rev().find_map(|p| {
                let pid = id(p);
                merged.iter().position(|m| id(m) == pid)
            })
        });
        match after {
            Some(position) => merged.insert(position + 1, item.clone()),
            None => merged.insert(0, item.clone()),
        }
    }
    merged
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    #[test]
    fn keeps_both_sides_of_different_changes() {
        let base = json!({"name": "Bot", "flow": {"nodes": [{"id": "a", "prompt": "x"}, {"id": "b"}]}});
        let ours = json!({"name": "Bot 2", "flow": {"nodes": [{"id": "a", "prompt": "x"}, {"id": "n", "type": "http"}, {"id": "b"}]}});
        let theirs = json!({"name": "Bot", "flow": {"nodes": [{"id": "a", "prompt": "y"}, {"id": "b"}]}});
        assert_eq!(
            merge3(&base, &ours, &theirs),
            json!({"name": "Bot 2", "flow": {"nodes": [{"id": "a", "prompt": "y"}, {"id": "n", "type": "http"}, {"id": "b"}]}})
        );
    }

    #[test]
    fn removals_and_conflicts() {
        let base = json!({"a": 1, "b": 2, "list": [{"id": "x"}, {"id": "y"}]});
        let ours = json!({"a": 3, "list": [{"id": "x"}]});
        let theirs = json!({"a": 4, "b": 2, "c": 5, "list": [{"id": "x"}, {"id": "y"}, {"id": "z"}]});
        // `a` changed on both sides: ours. `b` removed here, untouched there: removed. `c` and `z` added there: kept.
        assert_eq!(merge3(&base, &ours, &theirs), json!({"a": 3, "c": 5, "list": [{"id": "x"}, {"id": "z"}]}));
    }

    #[test]
    fn nothing_changed_here_takes_theirs() {
        let base = json!({"a": 1});
        assert_eq!(merge3(&base, &base, &json!({"a": 2})), json!({"a": 2}));
        assert_eq!(merge3(&json!(null), &json!({"a": 1}), &json!({"b": 2})), json!({"a": 1, "b": 2}));
    }
}
