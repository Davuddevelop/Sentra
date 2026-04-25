export const FILE_TOOLS = [
  {
    name: 'read_file',
    description: 'Read the full contents of a file at the given absolute path.',
    input_schema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Absolute file path' },
      },
      required: ['path'],
    },
  },
  {
    name: 'write_file',
    description: 'Write content to a file, creating it if it does not exist.',
    input_schema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Absolute file path' },
        content: { type: 'string', description: 'File content to write' },
      },
      required: ['path', 'content'],
    },
  },
  {
    name: 'run_bash',
    description: 'Execute a bash command and return stdout. Prefer read-only commands (find, grep, ls, cat). Use write_file for file creation.',
    input_schema: {
      type: 'object',
      properties: {
        command: { type: 'string', description: 'Bash command to execute' },
      },
      required: ['command'],
    },
  },
  {
    name: 'list_files',
    description: 'List files in a directory (one level deep). Returns a newline-separated list.',
    input_schema: {
      type: 'object',
      properties: {
        dir: { type: 'string', description: 'Absolute directory path' },
      },
      required: ['dir'],
    },
  },
]

// Read-only subset for audit agents that should never modify files
export const READ_TOOLS = FILE_TOOLS.filter(t => t.name !== 'write_file')
