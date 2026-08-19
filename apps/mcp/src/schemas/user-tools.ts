import type { ToolDefinition } from './index.js';

export const userTools: ToolDefinition[] = [
  {
    name: 'get_user_info',
    description:
      'Returns the authenticated Paxaver user context: their name, active school, students they are a guardian for, and available roles. ALWAYS call this first before any other tool to establish context. This is a read-only operation.',
    inputSchema: { type: 'object', properties: {} },
    outputSchema: {
      type: 'object',
      properties: {
        firstName: { type: 'string' },
        lastName: { type: 'string' },
        schoolSlug: { type: 'string' },
        schoolName: { type: 'string' },
        students: { type: 'array', items: { type: 'object' } },
        roles: { type: 'array', items: { type: 'string' } },
      },
    },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false, title: 'Get User Info' },
  },
  {
    name: 'update_student',
    description:
      "Updates a student profile (allergies, notes, grade, division, etc.) for a student the authenticated user is a guardian of. The student_id must be one of the user's own students (from get_user_info). This is a write operation that modifies student data — confirm with the user before making changes. Do NOT use this to look up arbitrary students.",
    inputSchema: {
      type: 'object',
      properties: {
        student_id: { type: 'string', description: 'ID of the student (must be your own student from get_user_info)' },
        first_name: { type: 'string' },
        last_name: { type: 'string' },
        known_as: { type: 'string' },
        grade: { type: 'string' },
        division: { type: 'string' },
        allergies: { type: 'string', description: 'Comma-separated allergen list' },
        notes: { type: 'string' },
        birthday: { type: 'string', description: 'YYYY-MM-DD' },
      },
      required: ['student_id'],
    },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false, title: 'Update Student' },
  },
];
