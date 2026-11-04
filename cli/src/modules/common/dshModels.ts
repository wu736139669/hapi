import type { DshModelsResponse } from '@hapi/protocol/apiTypes'
import { listDshModels } from '@/dsh/dshModels'

export type ListDshModelsForMachineResponse = DshModelsResponse

/**
 * Machine-global DSH model catalog from the Web runtime. `hapi dsh` drives the
 * long-running `dsh web` process, whose model picker is already provider-aware;
 * no ACP probe is needed.
 */
export async function listDshModelsForMachine(): Promise<ListDshModelsForMachineResponse> {
    return await listDshModels()
}
