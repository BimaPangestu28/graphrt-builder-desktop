//! MCP preset plugins (`runtime: mcp`): installing one adds its server, removing it removes the server.

use super::Fixture;
use crate::credentials::McpOAuthPart;
use crate::mcp::definitions::{load_definitions, McpAuthKind};

const GUIDE: &str = "- Start with `{server}/list_accounts`.\n";

/// Writes an installed MCP preset plugin folder (its guide pinned by checksum).
fn write_preset(fixture: &Fixture, name: &str, guide_checksum: Option<&str>) {
    let dir = fixture.plugins_dir().join(name);
    std::fs::create_dir_all(&dir).unwrap();
    std::fs::write(dir.join("guide.md"), GUIDE).unwrap();
    let checksum = guide_checksum.map_or_else(|| super::super::archive::sha256_hex(GUIDE.as_bytes()), str::to_owned);
    let manifest = serde_json::json!({
        "name": name,
        "version": "1.0.0",
        "description": "Upwork MCP server",
        "runtime": "mcp",
        "permissions": {"network": true},
        "mcp": {
            "url": "https://mcp.upwork.com/mcp",
            "auth": "oauth",
            "approval": {"default": "ask", "read_only": ["find_*", "get_*", "list_*", "search_*"]},
            "guide": "guide.md"
        },
        "checksums": {"guide.md": checksum},
        "templates": [{"id": "morning-jobs", "title": "Morning jobs", "description": "Find jobs", "prompt": "Every morning, find jobs"}]
    });
    std::fs::write(dir.join("graphrt-plugin.json"), manifest.to_string()).unwrap();
}

#[tokio::test]
async fn an_installed_preset_adds_its_server_and_templates_and_removing_it_signs_out() {
    let fixture = Fixture::new();
    write_preset(&fixture, "upwork", None);
    fixture.service.reload();

    let installed = fixture.service.installed("upwork").unwrap();
    assert_eq!(installed.load_error, None);
    assert!(!installed.needs_node_runtime, "no code runs");
    assert_eq!(installed.mcp_server.as_ref().map(|server| server.auth.as_str()), Some("oauth"));
    let servers = load_definitions(&fixture.db).unwrap();
    assert_eq!(servers.len(), 1);
    assert_eq!(servers[0].name, "upwork");
    assert_eq!(servers[0].plugin.as_deref(), Some("upwork"));
    assert_eq!(servers[0].auth, McpAuthKind::Oauth);
    assert!(servers[0].approval.default_asks);
    assert_eq!(servers[0].guide.as_deref(), Some(GUIDE));
    let templates = fixture.service.templates();
    assert_eq!(templates.len(), 1);
    assert_eq!((templates[0].plugin.as_str(), templates[0].id.as_str()), ("upwork", "morning-jobs"));

    // A signed-in server: removing the plugin forgets the sign-in (no revocation endpoint here).
    fixture.credentials.set_mcp_oauth("upwork", McpOAuthPart::RefreshToken, "refresh").unwrap();
    fixture.service.remove("upwork").await.unwrap();
    assert!(load_definitions(&fixture.db).unwrap().is_empty());
    assert_eq!(fixture.credentials.read_mcp_oauth("upwork", McpOAuthPart::RefreshToken).unwrap(), None);
    assert!(fixture.service.templates().is_empty());
}

#[tokio::test]
async fn a_preset_whose_guide_was_changed_does_not_load() {
    let fixture = Fixture::new();
    write_preset(&fixture, "upwork", Some(&"0".repeat(64)));
    fixture.service.reload();
    assert!(fixture.service.installed("upwork").unwrap().load_error.is_some());
    assert!(load_definitions(&fixture.db).unwrap().is_empty(), "a plugin that does not load adds no server");
}

#[test]
fn the_catalog_carries_an_mcp_preset_server_and_drops_a_bad_one() {
    let entry = |mcp_server: serde_json::Value| -> crate::plugins::models::CatalogPlugin {
        serde_json::from_value(serde_json::json!({
            "name": "upwork", "version": "1.0.0", "tarball_url": "https://example.test/upwork.tar.gz",
            "sha256": "0".repeat(64), "mcp_server": mcp_server
        }))
        .unwrap()
    };
    let preset = entry(serde_json::json!({"url": "https://mcp.upwork.com/mcp", "auth": "oauth"}));
    assert_eq!(
        preset.mcp_server.map(|server| (server.url, server.auth)),
        Some(("https://mcp.upwork.com/mcp".into(), "oauth".into()))
    );
    for bad in [
        serde_json::json!({"url": "http://x/mcp"}),
        serde_json::json!({"url": "https://x", "auth": "basic"}),
        serde_json::json!(7),
    ] {
        assert_eq!(entry(bad.clone()).mcp_server, None, "{bad}");
    }
}

/// Sideloads a packed preset (`node scripts/pack-plugins.mjs upwork` in graphrt-plugins), the way the owner can
/// try it before a catalog release: `GRAPHRT_TEST_MCP_TARBALL=<path> cargo test sideloads_a_packed -- --ignored`.
#[tokio::test]
#[ignore = "needs a packed preset tarball"]
async fn sideloads_a_packed_preset_tarball() {
    let Ok(tarball) = std::env::var("GRAPHRT_TEST_MCP_TARBALL") else { panic!("set GRAPHRT_TEST_MCP_TARBALL") };
    let fixture = Fixture::new();
    crate::desktop::app_settings::AppSettings { developer_mode: true, ..Default::default() }.save(&fixture.db).unwrap();
    let installed = fixture.service.install_local(&tarball, false).await.unwrap();
    assert_eq!(installed.load_error, None);
    let servers = load_definitions(&fixture.db).unwrap();
    assert_eq!(servers[0].name, installed.name);
    assert_eq!(servers[0].auth, McpAuthKind::Oauth);
    assert!(servers[0].guide.as_deref().is_some_and(|guide| guide.contains("{server}/confirm_preview")));
    assert_eq!(fixture.service.templates().len(), 3);
}
