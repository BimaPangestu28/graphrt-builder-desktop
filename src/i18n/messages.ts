import type { Locale, Translation } from './types'
import { lib } from './locales/lib'
import { misc } from './locales/misc'
import { team } from './locales/team'
import { chatbot } from './locales/chatbot'
import { newAgent } from './locales/newAgent'
import { nodes } from './locales/nodes'
import { builder } from './locales/builder'
import { deploy } from './locales/deploy'
import { connections } from './locales/connections'
import { schedule } from './locales/schedule'
import { agentRun } from './locales/agentRun'
import { runs } from './locales/runs'
import { inbox } from './locales/inbox'
import { plugins } from './locales/plugins'
import { skills } from './locales/skills'
import { learning } from './locales/learning'
import { knowledge } from './locales/knowledge'
import { home } from './locales/home'
import { settings } from './locales/settings'
import { common } from './locales/common'
import { shell } from './locales/shell'
import { welcome } from './locales/welcome'
import { platform } from './locales/platform'
import { files } from './locales/files'
import { visuals } from './locales/visuals'

/**
 * Every dictionary of the app, by language. Add an area by importing its `defineMessages` pair
 * and listing it in both objects below (the completeness test checks they match).
 */
const english = {
  lib: lib.en,
  misc: misc.en,
  team: team.en,
  chatbot: chatbot.en,
  newAgent: newAgent.en,
  nodes: nodes.en,
  builder: builder.en,
  deploy: deploy.en,
  connections: connections.en,
  schedule: schedule.en,
  agentRun: agentRun.en,
  runs: runs.en,
  inbox: inbox.en,
  plugins: plugins.en,
  skills: skills.en,
  learning: learning.en,
  knowledge: knowledge.en,
  home: home.en,
  settings: settings.en,
  common: common.en,
  shell: shell.en,
  welcome: welcome.en,
  platform: platform.en,
  visuals: visuals.en,
  files: files.en,
}

export type Messages = Translation<typeof english>

const indonesian: Messages = {
  lib: lib.id,
  misc: misc.id,
  team: team.id,
  chatbot: chatbot.id,
  newAgent: newAgent.id,
  nodes: nodes.id,
  builder: builder.id,
  deploy: deploy.id,
  connections: connections.id,
  schedule: schedule.id,
  agentRun: agentRun.id,
  runs: runs.id,
  inbox: inbox.id,
  plugins: plugins.id,
  skills: skills.id,
  learning: learning.id,
  knowledge: knowledge.id,
  home: home.id,
  settings: settings.id,
  common: common.id,
  shell: shell.id,
  welcome: welcome.id,
  platform: platform.id,
  visuals: visuals.id,
  files: files.id,
}

export const dictionaries: Record<Locale, Messages> = { en: english, id: indonesian }
