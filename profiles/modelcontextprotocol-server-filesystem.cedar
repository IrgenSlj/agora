// Profile: @modelcontextprotocol/server-filesystem, read-only.
// package: npm:@modelcontextprotocol/server-filesystem
// tools read from version 2.3.0 of the published package on 2026-11-12.
//
// Permits listing, reading and searching. Not permitted, so denied under an
// agora.cedar: write_file, edit_file, append_file, copy_file, move_file and
// create_directory. Add them in your own rule if a task needs them.

@id("profile-{{server}}-read")
permit (principal, action == Action::"call", resource)
when {
  resource.mcp &&
  resource.server == "{{server}}" &&
  [
    "read_file",
    "read_text_file",
    "read_media_file",
    "read_multiple_files",
    "list_directory",
    "list_directory_with_sizes",
    "directory_tree",
    "search_files",
    "get_file_info",
    "list_allowed_directories"
  ].contains(resource.name)
};
