/**
 * Sample data for screen 13 (Team): a coordinator agent that splits a goal across member agents.
 * Only `src/api/sampleBackend` reads it (browser preview, tests); the desktop app shows real runs.
 */

export type TeamMemberState = 'done' | 'working' | 'needsYou' | 'waiting'

export interface TeamMember {
  id: string
  name: string
  state: TeamMemberState
  agentLabel: string
  /** Progress line. For a member that needs you this is the call to action. */
  progress: string
}

export interface TeamPlanItem {
  memberName: string
  task: string
}

export interface TeamActivity {
  time: string
  /** Sentence parts; `isMember` parts are shown in bold. */
  parts: Array<{ text: string; isMember?: boolean }>
}

export const teamName = 'Catering sales team'

export const teamGoalMessage = 'Get us 20 new catering clients in Bandar Lampung this month. Focus on cafes and offices'

export const teamPlan: TeamPlanItem[] = [
  { memberName: 'Researcher', task: 'finds 60 cafes and offices' },
  { memberName: 'Qualifier', task: 'keeps the ones scoring 6 or more' },
  { memberName: 'Outreach', task: 'messages them, 15 a day, after you approve' },
  { memberName: 'Reporter', task: 'sends you a recap every Friday' },
]

export const teamBudgetNote = 'Budget so far $0.42 of $5 this week'

export const teamMembers: TeamMember[] = [
  { id: 'researcher', name: 'Researcher', state: 'done', agentLabel: 'Agent · Maps search', progress: 'Found 64 places, handed to Qualifier' },
  { id: 'qualifier', name: 'Qualifier', state: 'working', agentLabel: 'Agent · Lead qualifier v3', progress: 'Scoring 38 of 64' },
  { id: 'outreach', name: 'Outreach', state: 'needsYou', agentLabel: 'Agent · Maps leads to WhatsApp', progress: 'Review 15 messages' },
  { id: 'reporter', name: 'Reporter', state: 'waiting', agentLabel: 'Agent · Sales recap to Telegram', progress: 'Next recap Friday 17:00' },
]

export const teamActivity: TeamActivity[] = [
  { time: '13:05', parts: [{ text: 'Qualifier', isMember: true }, { text: ' passed 9 places to ' }, { text: 'Outreach', isMember: true }] },
  { time: '12:58', parts: [{ text: 'Outreach', isMember: true }, { text: ' asked ' }, { text: 'Qualifier', isMember: true }, { text: ' to drop places already messaged' }] },
  { time: '12:40', parts: [{ text: 'Coordinator', isMember: true }, { text: ' moved offices ahead of cafes, cafes reply less' }] },
  { time: '12:31', parts: [{ text: 'Researcher', isMember: true }, { text: ' finished with 64 places' }] },
]

/** Sample guardrail: most member-agent calls in one team run. */
export const sampleMaxAgentCallsPerRun = 20

export const coordinatorAcknowledgement = 'Got it. I will update the plan and tell the team'
