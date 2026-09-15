import type { Machine } from '@/types/api'
import { isMachineCapabilitySkewed, runnerSupportsAgentTeam } from '@hapi/protocol/runnerCapabilities'
import { useTranslation } from '@/lib/use-translation'
import { SelectControl } from '@/components/ui/select-control'

function getMachineTitle(machine: Machine): string {
    if (machine.metadata?.displayName) return machine.metadata.displayName
    if (machine.metadata?.host) return machine.metadata.host
    return machine.id.slice(0, 8)
}

function getMachineOptionLabel(
    machine: Machine,
    updateRequiredLabel: string,
    teamUnsupportedLabel: string,
    requiresAgentTeam: boolean
): string {
    const title = getMachineTitle(machine)
    const platform = machine.metadata?.platform ? ` (${machine.metadata.platform})` : ''
    const version = machine.metadata?.happyCliVersion
        ? ` · CLI ${machine.metadata.happyCliVersion}`
        : ''
    const skew = machine.active && isMachineCapabilitySkewed(machine.metadata?.capabilities)
        ? ` · ${updateRequiredLabel}`
        : ''
    const team = requiresAgentTeam && !runnerSupportsAgentTeam(machine.runnerState)
        ? ` · ${teamUnsupportedLabel}`
        : ''
    return `${title}${platform}${version}${skew}${team}`
}

export function MachineSelector(props: {
    machines: Machine[]
    machineId: string | null
    isLoading?: boolean
    isDisabled: boolean
    /** Team mode: machines without the agentTeam capability cannot host team sessions. */
    requiresAgentTeam?: boolean
    onChange: (machineId: string) => void
}) {
    const { t } = useTranslation()

    return (
        <div className="flex flex-col gap-1.5 px-3 py-3">
            <label className="text-xs font-medium text-[var(--app-hint)]">
                {t('newSession.machine')}
            </label>
            <SelectControl
                value={props.machineId ?? ''}
                onChange={(e) => props.onChange(e.target.value)}
                disabled={props.isDisabled}
                className="rounded-md border border-[var(--app-border)] bg-[var(--app-bg)] py-2 pl-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--app-link)] disabled:opacity-50"
            >
                {props.isLoading && (
                    <option value="">{t('loading.machines')}</option>
                )}
                {!props.isLoading && props.machines.length === 0 && (
                    <option value="">{t('misc.noMachines')}</option>
                )}
                {props.machines.map((m) => {
                    const blocked = props.requiresAgentTeam === true && !runnerSupportsAgentTeam(m.runnerState)
                    return (
                        <option key={m.id} value={m.id} disabled={blocked}>
                            {getMachineOptionLabel(
                                m,
                                t('runner.skew.updateRequired'),
                                t('runner.skew.teamUnsupported'),
                                props.requiresAgentTeam === true
                            )}
                        </option>
                    )
                })}
            </SelectControl>
        </div>
    )
}
