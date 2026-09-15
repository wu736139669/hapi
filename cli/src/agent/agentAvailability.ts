import { existsSync, statSync } from 'node:fs'
import { isAbsolute } from 'node:path'
import {
    CREATABLE_AGENT_FLAVORS,
    type AgentAvailabilityEntry,
    type AgentAvailabilityResponse,
    type AgentFlavor,
} from '@hapi/protocol'
import { getDefaultClaudeCodePath } from '@/claude/sdk/utils'
import { resolveCodexCommand } from '@/codex/utils/codexExecutable'
import { DshWebClient, resolveDshWebUrl } from '@/dsh/dshWebClient'
import { getAgentLaunchCommand, resolveExecutable } from './agentLaunchCommand'

const DSH_AVAILABILITY_TIMEOUT_MS = 1_500

type LaunchEnvironment = Record<string, string | undefined>
type LaunchContext = 'runner' | 'terminal'

type AgentLaunchSpec = {
    command: string
    args: string[]
}

function resolveLaunchSpec(agent: AgentFlavor, env: LaunchEnvironment, context: LaunchContext): AgentLaunchSpec {
    if (agent === 'claude') {
        return { command: getDefaultClaudeCodePath(env), args: [] }
    }
    if (agent === 'codex') {
        // Remote Codex sessions launch app-server through this explicit
        // override. Validate the same command the session will actually use,
        // rather than falling back to an unrelated PATH/Desktop install.
        if (context === 'runner' && env.HAPI_CODEX_APP_SERVER_BIN) {
            return { command: env.HAPI_CODEX_APP_SERVER_BIN.trim(), args: [] }
        }
        return resolveCodexCommand(env)
    }
    return { command: getAgentLaunchCommand(agent, env), args: [] }
}

function hasResolvableCommand(spec: AgentLaunchSpec, env: LaunchEnvironment): boolean {
    const executable = resolveExecutable(spec.command, {
        pathValue: env.PATH,
        pathExt: env.PATHEXT,
    })
    if (!executable) return false

    // Windows Codex npm shims resolve to `node <absolute codex.js>`.
    const script = spec.args[0]
    if (script && isAbsolute(script)) {
        try {
            return existsSync(script) && statSync(script).isFile()
        } catch {
            return false
        }
    }
    return true
}

export function getAgentAvailability(
    agent: AgentFlavor,
    env: LaunchEnvironment = process.env,
    context: LaunchContext = 'runner',
): AgentAvailabilityEntry {
    if (agent === 'gemini') {
        return { agent, available: false, reason: 'not_found' }
    }

    // DSH sessions connect to an already-running `dsh web` host instead of
    // spawning an ACP executable. The synchronous terminal picker can only
    // validate the URL; runner availability performs the live probe below.
    if (agent === 'dsh') {
        try {
            resolveDshWebUrl(env.HAPI_DSH_URL)
            return { agent, available: true }
        } catch {
            return { agent, available: false, reason: 'invalid_configuration' }
        }
    }

    let spec: AgentLaunchSpec
    try {
        spec = resolveLaunchSpec(agent, env, context)
    } catch {
        // Claude's resolver throws when the default command is simply absent;
        // that is an installation miss, not malformed static configuration.
        return {
            agent,
            available: false,
            reason: agent === 'claude' ? 'not_found' : 'invalid_configuration',
        }
    }

    if (hasResolvableCommand(spec, env)) {
        return { agent, available: true }
    }
    return {
        agent,
        available: false,
        reason: context === 'runner' && agent === 'codex' && Boolean(env.HAPI_CODEX_APP_SERVER_BIN)
            ? 'invalid_configuration'
            : 'not_found',
    }
}

async function getDshWebAvailability(
    env: LaunchEnvironment,
    fetchImpl: typeof fetch,
): Promise<AgentAvailabilityEntry> {
    let client: DshWebClient
    try {
        client = new DshWebClient(env.HAPI_DSH_URL, fetchImpl)
    } catch {
        return { agent: 'dsh', available: false, reason: 'invalid_configuration' }
    }

    try {
        await client.describe(AbortSignal.timeout(DSH_AVAILABILITY_TIMEOUT_MS))
        return { agent: 'dsh', available: true }
    } catch {
        return { agent: 'dsh', available: false, reason: 'not_found' }
    }
}

export async function getAgentAvailabilityResponse(
    env: LaunchEnvironment = process.env,
    fetchImpl: typeof fetch = fetch,
): Promise<AgentAvailabilityResponse> {
    return {
        agents: await Promise.all(CREATABLE_AGENT_FLAVORS.map((agent) => (
            agent === 'dsh'
                ? getDshWebAvailability(env, fetchImpl)
                : getAgentAvailability(agent, env)
        ))),
    }
}

export function agentUnavailableMessage(entry: AgentAvailabilityEntry): string {
    const detail = entry.reason === 'invalid_configuration'
        ? 'has invalid runner configuration'
        : 'is not installed or is not on PATH'
    return `${entry.agent} ${detail}`
}
