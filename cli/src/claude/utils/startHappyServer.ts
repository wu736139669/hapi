/**
 * HAPI MCP server
 * Provides HAPI CLI specific tools including chat session title management
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createServer, type IncomingMessage } from "node:http";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { AddressInfo } from "node:net";
import { z } from "zod";
import { logger } from "@/ui/logger";
import { ApiSessionClient } from "@/api/apiSession";
import { randomUUID } from "node:crypto";
import {
    detectDisplayMediaMimeType,
    detectImageMimeType,
    detectVideoMimeType,
    readBoundedRegularFile,
    registerGeneratedImage,
} from "@/modules/common/generatedImages";
import type { InlineMediaSource } from "@/modules/common/inlineMediaSource";
import { DISPLAY_IMAGE_PROMPT_CURSOR, DISPLAY_MEDIA_PROMPT_CURSOR, DISPLAY_VIDEO_PROMPT_CURSOR } from "@/modules/common/displayImagePrompt";
import { resolveSkill } from "@/modules/common/skills";
import {
    INSPECT_PEER_TOOL_DESCRIPTION,
    PING_PEER_TOOL_DESCRIPTION,
    SESSION_ID_PREFIX_PARAM_DESCRIPTION,
} from '@hapi/protocol/sessionCitation'
import { PingPeerError, formatInspectPeerReport, formatPeerSessionsList, inspectPeer, listPeerSessions, peerListFetchLimit, pingPeer } from "@/modules/pingPeer/pingPeer";
import {
    TeamClientError,
    formatTeamMessages,
    formatTeamStatus,
    formatTeamTasks,
    readTeamMessages,
    probeTeamsSupport,
    resolveCurrentTeam,
    sendTeamMessage,
    spawnTeamMember,
    updateTeamTask
} from "@/modules/team/teamClient";

type StartHappyServerOptions = {
    emitTitleSummary?: boolean;
    enableChangeTitle?: boolean;
    skillLookup?: {
        workingDirectory: string;
        flavor: string;
    };
};

/** Registered on the MCP server, but never pre-approved via Claude --allowedTools. */
const CLAUDE_MANUAL_APPROVAL_HAPI_TOOLS = new Set([
    'display_media',
    'display_video',
    'ping_peer',
    'inspect_peer',
    'spawn_peer'
]);

/**
 * Map HAPI MCP tool names to Claude `--allowedTools` entries.
 * Keeps `display_media` / `display_video` (arbitrary local-path readers), `ping_peer`, and
 * `inspect_peer` off the auto-allow list so they still prompt.
 * `list_peers` stays allowed (discovery shortlist only).
 */
export function toClaudeAllowedHapiMcpTools(toolNames: string[]): string[] {
    return toolNames
        .filter((toolName) => !CLAUDE_MANUAL_APPROVAL_HAPI_TOOLS.has(toolName))
        .map((toolName) => `mcp__hapi__${toolName}`);
}

function createHapiMcpServer(
    client: ApiSessionClient,
    emitTitleSummary: boolean,
    enableChangeTitle: boolean,
    skillLookup: StartHappyServerOptions['skillLookup'],
    teamToolsEnabled: boolean
): McpServer {
    const handler = async (title: string) => {
        logger.debug('[hapiMCP] Changing title to:', title);
        try {
            if (emitTitleSummary) {
                client.sendClaudeSessionMessage({
                    type: 'summary',
                    summary: title,
                    leafUuid: randomUUID()
                });
            }

            return { success: true };
        } catch (error) {
            return { success: false, error: String(error) };
        }
    };

    const mcp = new McpServer({
        name: "HAPI MCP",
        version: "1.0.0",
    });

    const changeTitleInputSchema: z.ZodTypeAny = z.object({
        title: z.string().describe('The new title for the chat session'),
    });

    const displayImageInputSchema: z.ZodTypeAny = z.object({
        path: z.string().describe('Absolute filesystem path of the local image to display to the human user. This file is sent for user display, not provided to the model for image inspection'),
        title: z.string().optional().describe('Optional display title or filename shown to the human user'),
    });

    const skillLookupInputSchema: z.ZodTypeAny = z.object({
        name: z.string().trim().min(1).max(128).describe('Exact skill name shown by HAPI skill autocomplete'),
    });

    const displayVideoInputSchema: z.ZodTypeAny = z.object({
        path: z.string().describe('Local filesystem path of the video to display inline (mp4 or webm)'),
        title: z.string().optional().describe('Optional display title or filename for the video'),
    });

    const displayMediaInputSchema: z.ZodTypeAny = z.object({
        path: z.string().describe('Local filesystem path of the media or file to send to the user'),
        title: z.string().trim().min(1).max(255).optional().describe('Optional display title or filename'),
    });

    const pingPeerInputSchema: z.ZodTypeAny = z.object({
        sessionIdPrefix: z.string().trim().min(1).describe(SESSION_ID_PREFIX_PARAM_DESCRIPTION),
        message: z.string().min(1).describe('Message text to deliver to the target session'),
    });

    const maxInlineMediaBytes = 25 * 1024 * 1024;

    const inspectPeerInputSchema: z.ZodTypeAny = z.object({
        sessionIdPrefix: z.string().trim().min(1).describe(SESSION_ID_PREFIX_PARAM_DESCRIPTION),
        messageLimit: z.number().int().min(1).max(100).optional().describe(
            'Recent message page size (default 30, max 100). Text snippets only.'
        ),
    });

    const listPeersInputSchema: z.ZodTypeAny = z.object({
        limit: z.number().int().min(1).max(100).optional().describe(
            'Max sessions to return (default 30, max 100). Newest updatedAt first.'
        ),
    });

    async function displayInlineMedia(
        args: { path: string; title?: string },
        mediaKind: 'image' | 'video' | 'media',
        toolName: 'display_image' | 'display_video' | 'display_media'
    ) {
        const bytes = await readBoundedRegularFile(args.path, maxInlineMediaBytes);
        const mimeType = mediaKind === 'video'
            ? detectVideoMimeType(bytes)
            : mediaKind === 'image'
                ? detectImageMimeType(bytes)
                : detectDisplayMediaMimeType(bytes);
        if (!mimeType) {
            throw new Error(mediaKind === 'video' ? 'Unsupported video content' : 'Unsupported image content');
        }

        const media = registerGeneratedImage({
            id: randomUUID(),
            path: args.path,
            fileName: args.title,
            mimeType,
            bytes
        });

        const source: InlineMediaSource = {
            ingress: 'mcp',
            toolName,
        };

        client.sendAgentMessage({
            type: 'generated-image',
            imageId: media.id,
            fileName: media.fileName,
            mimeType: media.mimeType,
            id: randomUUID(),
            source,
        });

        return media;
    }
    if (enableChangeTitle) {
        mcp.registerTool<any, any>('change_title', {
            description: 'Change the title of the current HAPI chat session. Call once when the user\'s primary objective is clear; use a concise task title.',
            title: 'Change Chat Title',
            inputSchema: changeTitleInputSchema,
        }, async (args: { title: string }) => {
            const response = await handler(args.title);
            logger.debug('[hapiMCP] Response:', response);

            if (response.success) {
                return {
                    content: [
                        {
                            type: 'text' as const,
                            text: `Successfully changed chat title to: "${args.title}"`,
                        },
                    ],
                    isError: false,
                };
            }

            return {
                content: [
                    {
                        type: 'text' as const,
                        text: `Failed to change chat title: ${response.error || 'Unknown error'}`,
                    },
                ],
                isError: true,
            };
        });
    }

    mcp.registerTool<any, any>('display_image', {
        description: `Display a local image file to the human user inline in the current HAPI chat session. ${DISPLAY_IMAGE_PROMPT_CURSOR}`,
        title: 'Display Image',
        inputSchema: displayImageInputSchema,
    }, async (args: { path: string; title?: string }) => {
        logger.debug('[hapiMCP] Display image:', args.path);

        try {
            const image = await displayInlineMedia(args, 'image', 'display_image');

            return {
                content: [
                    {
                        type: 'text' as const,
                        text: `Displayed image: ${image.fileName}`,
                    },
                ],
                isError: false,
            };
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            logger.debug('[hapiMCP] Failed to display image:', message);
            return {
                content: [
                    {
                        type: 'text' as const,
                        text: `Failed to display image: ${message}`,
                    },
                ],
                isError: true,
            };
        }
    });

    mcp.registerTool<any, any>('display_video', {
        description: `Display a local mp4 or webm file inline in the current HAPI chat session. ${DISPLAY_VIDEO_PROMPT_CURSOR}`,
        title: 'Display Video',
        inputSchema: displayVideoInputSchema,
    }, async (args: { path: string; title?: string }) => {
        logger.debug('[hapiMCP] Display video:', args.path);

        try {
            const video = await displayInlineMedia(args, 'video', 'display_video');

            return {
                content: [
                    {
                        type: 'text' as const,
                        text: `Displayed video: ${video.fileName}`,
                    },
                ],
                isError: false,
            };
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            logger.debug('[hapiMCP] Failed to display video:', message);
            return {
                content: [
                    {
                        type: 'text' as const,
                        text: `Failed to display video: ${message}`,
                    },
                ],
                isError: true,
            };
        }
    });

    mcp.registerTool<any, any>('display_media', {
        description: `Send a local image, video, audio, or other file to the current HAPI chat session. Recognized media is shown inline; other files use a download card. ${DISPLAY_MEDIA_PROMPT_CURSOR}`,
        title: 'Display Media',
        inputSchema: displayMediaInputSchema,
    }, async (args: { path: string; title?: string }) => {
        logger.debug('[hapiMCP] Display media:', args.path);

        try {
            const media = await displayInlineMedia(args, 'media', 'display_media');
            return {
                content: [{ type: 'text' as const, text: `Displayed media: ${media.fileName}` }],
                isError: false,
            };
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            logger.debug('[hapiMCP] Failed to display media:', message);
            return {
                content: [{ type: 'text' as const, text: `Failed to display media: ${message}` }],
                isError: true,
            };
        }
    });

    mcp.registerTool<any, any>('ping_peer', {
        description: PING_PEER_TOOL_DESCRIPTION,
        title: 'Ping Peer Session',
        inputSchema: pingPeerInputSchema,
    }, async (args: { sessionIdPrefix: string; message: string }) => {
        logger.debug('[hapiMCP] ping_peer:', args.sessionIdPrefix);
        try {
            const result = await pingPeer({
                sessionIdPrefix: args.sessionIdPrefix,
                message: args.message,
            });
            return {
                content: [
                    {
                        type: 'text' as const,
                        text: `Delivered to ${result.sessionId}${result.resumed ? ' (resumed)' : ''} (${result.name})`,
                    },
                ],
                isError: false,
            };
        } catch (error) {
            const message = error instanceof PingPeerError
                ? error.message
                : error instanceof Error
                    ? error.message
                    : String(error);
            logger.debug('[hapiMCP] ping_peer failed:', message);
            return {
                content: [
                    {
                        type: 'text' as const,
                        text: `Failed to ping peer: ${message}`,
                    },
                ],
                isError: true,
            };
        }
    });

    mcp.registerTool<any, any>('inspect_peer', {
        description: INSPECT_PEER_TOOL_DESCRIPTION,
        title: 'Inspect Peer Session',
        inputSchema: inspectPeerInputSchema,
    }, async (args: { sessionIdPrefix: string; messageLimit?: number }) => {
        logger.debug('[hapiMCP] inspect_peer:', args.sessionIdPrefix);
        try {
            const result = await inspectPeer({
                sessionIdPrefix: args.sessionIdPrefix,
                messageLimit: args.messageLimit,
            });
            return {
                content: [
                    {
                        type: 'text' as const,
                        text: formatInspectPeerReport(result),
                    },
                ],
                isError: false,
            };
        } catch (error) {
            const message = error instanceof PingPeerError
                ? error.message
                : error instanceof Error
                    ? error.message
                    : String(error);
            logger.debug('[hapiMCP] inspect_peer failed:', message);
            return {
                content: [
                    {
                        type: 'text' as const,
                        text: `Failed to inspect peer: ${message}`,
                    },
                ],
                isError: true,
            };
        }
    });

    mcp.registerTool<any, any>('list_peers', {
        description: 'List peer HAPI sessions on the same hub/namespace (id prefix, active, flavor, name). Uses this session\'s hub credentials - works from runner-spawned agents without being on the hub host. Prefer this over shelling `hapi ping-peer --list`. Then call inspect_peer / ping_peer with a listed id.',
        title: 'List Peer Sessions',
        inputSchema: listPeersInputSchema,
    }, async (args: { limit?: number }) => {
        logger.debug('[hapiMCP] list_peers');
        try {
            const limit = args.limit ?? 30;
            const sessions = await listPeerSessions({
                limit: peerListFetchLimit(limit, { excludeCaller: true }),
            });
            const peers = sessions.filter((session) => session.id !== client.sessionId);
            const hasMore = peers.length > limit;
            return {
                content: [
                    {
                        type: 'text' as const,
                        text: formatPeerSessionsList(peers, {
                            maxRows: limit,
                            hasMore,
                        }),
                    },
                ],
                isError: false,
            };
        } catch (error) {
            const message = error instanceof PingPeerError
                ? error.message
                : error instanceof Error
                    ? error.message
                    : String(error);
            logger.debug('[hapiMCP] list_peers failed:', message);
            return {
                content: [
                    {
                        type: 'text' as const,
                        text: `Failed to list peers: ${message}`,
                    },
                ],
                isError: true,
            };
        }
    });

    if (teamToolsEnabled) {
        const teamErrorText = (error: unknown): string => {
            if (error instanceof TeamClientError) return error.message;
            return error instanceof Error ? error.message : String(error);
        };
        // Membership is resolved per call so sessions that join a team after
        // startup (e.g. adopted as lead) get working tools without a restart.
        const requireTeam = async () => {
            const status = await resolveCurrentTeam({ sessionId: client.sessionId });
            if (!status) {
                throw new TeamClientError('not_in_team', 'This session is not a member of any team yet. Ask the human to add it to a team first.');
            }
            return status;
        };

        mcp.registerTool<any, any>('team_status', {
            description: 'Agent Team: show your team, members (live status), pending tasks and remaining budget. Call this right after starting as a team member to pick up your assignment.',
            title: 'Team Status',
            inputSchema: z.object({}),
        }, async () => {
            try {
                const status = await requireTeam();
                return { content: [{ type: 'text' as const, text: formatTeamStatus(status) }], isError: false };
            } catch (error) {
                const message = teamErrorText(error);
                return { content: [{ type: 'text' as const, text: `Failed to load team status: ${message}` }], isError: error instanceof TeamClientError && error.code === 'not_in_team' ? false : true };
            }
        });

        mcp.registerTool<any, any>('team_read', {
            description: 'Agent Team: read the shared team message log (all members see the same log). Use afterSeq from a previous read to fetch only new messages. Broadcasts are pull-only: call this before starting work to catch up.',
            title: 'Read Team Messages',
            inputSchema: z.object({
                afterSeq: z.number().int().nonnegative().optional().describe('Return messages with seq greater than this'),
                limit: z.number().int().positive().max(2000).optional().describe('Max messages to return (default 100)'),
            }),
        }, async (args: { afterSeq?: number; limit?: number }) => {
            try {
                const status = await requireTeam();
                const messages = await readTeamMessages({
                    sessionId: client.sessionId,
                    teamId: status.team.id,
                    afterSeq: args.afterSeq,
                    limit: args.limit ?? 100,
                });
                return { content: [{ type: 'text' as const, text: formatTeamMessages(messages, client.sessionId) }], isError: false };
            } catch (error) {
                return { content: [{ type: 'text' as const, text: `Failed to read team messages: ${teamErrorText(error)}` }], isError: true };
            }
        });

        mcp.registerTool<any, any>('team_send', {
            description: 'Agent Team: send a message to teammates. to="all" (default) writes to the shared log only; to="<role or session id prefix>" or to="lead" wakes that member; to="human" notifies the human out-of-band (no inbox item); use kind="decision" when you need the human to decide something. Use inReplyTo=<seq> when answering a peer message so the hub can stop runaway back-and-forth. Do NOT use this for routine replies to the human.',
            title: 'Send Team Message',
            inputSchema: z.object({
                text: z.string().min(1).describe('Message text'),
                to: z.string().min(1).optional().describe('"all" (default), "lead", "human", or a member session id/prefix'),
                kind: z.enum(['chat', 'status', 'question', 'task-update', 'decision']).optional().describe('Message kind (default chat)'),
                inReplyTo: z.number().int().positive().optional().describe('seq of the message you are replying to'),
            }),
        }, async (args: { text: string; to?: string; kind?: string; inReplyTo?: number }) => {
            try {
                const status = await requireTeam();
                const message = await sendTeamMessage({
                    sessionId: client.sessionId,
                    teamId: status.team.id,
                    text: args.text,
                    to: args.to,
                    kind: args.kind,
                    inReplyTo: args.inReplyTo,
                });
                return {
                    content: [{ type: 'text' as const, text: `Sent as team message #${message.seq}${args.to && args.to !== 'all' ? ` to ${args.to}` : ' (broadcast)'}` }],
                    isError: false,
                };
            } catch (error) {
                return { content: [{ type: 'text' as const, text: `Failed to send team message: ${teamErrorText(error)}` }], isError: true };
            }
        });

        mcp.registerTool<any, any>('spawn_peer', {
            description: 'Agent Team: spawn a new teammate session (own context window) with a role and an initial task. Members inherit your tool/model/thinking level/permission by default - only override when the human asks. Spawning costs tokens - prefer reusing idle members; requires user approval.',
            title: 'Spawn Team Peer',
            inputSchema: z.object({
                role: z.string().min(1).describe('Role / display name, e.g. "Builder A" or "Reviewer". Must be unique in the team.'),
                task: z.string().min(1).optional().describe('Initial task brief delivered to the new member'),
                agent: z.string().min(1).optional().describe('Agent flavor (claude, codex, ...). Defaults to the caller flavor.'),
                model: z.string().min(1).optional().describe('Optional model override (defaults to yours)'),
                modelReasoningEffort: z.string().min(1).max(50).optional().describe('Optional thinking-level override (defaults to yours)'),
                permissionMode: z.string().min(1).max(50).optional().describe('Optional permission-mode override (defaults to yours)'),
                worktree: z.boolean().optional().describe('Run the member in an isolated git worktree (default: follow the caller)'),
                worktreeName: z.string().min(1).max(80).optional().describe('Explicit worktree name'),
            }),
        }, async (args: { role: string; task?: string; agent?: string; model?: string; modelReasoningEffort?: string; permissionMode?: string; worktree?: boolean; worktreeName?: string }) => {
            try {
                const status = await requireTeam();
                const result = await spawnTeamMember({
                    sessionId: client.sessionId,
                    teamId: status.team.id,
                    role: args.role,
                    task: args.task,
                    agent: args.agent,
                    model: args.model,
                    modelReasoningEffort: args.modelReasoningEffort,
                    permissionMode: args.permissionMode,
                    sessionType: args.worktree === undefined ? undefined : (args.worktree ? 'worktree' : 'simple'),
                    worktreeName: args.worktreeName,
                });
                return {
                    content: [{
                        type: 'text' as const,
                        text: `Spawned ${result.role} (session ${result.sessionId.slice(0, 8)})${result.taskId ? ` with task ${result.taskId}` : ''}. The task is delivered when the member is ready.`,
                    }],
                    isError: false,
                };
            } catch (error) {
                return { content: [{ type: 'text' as const, text: `Failed to spawn peer: ${teamErrorText(error)}` }], isError: true };
            }
        });

        mcp.registerTool<any, any>('team_task', {
            description: 'Agent Team: list team tasks or update one. Moving a task to doing/done requires its dependencies to be done; marking a task done requires a deliverable (evidence: branch/commit/files/test result).',
            title: 'Team Tasks',
            inputSchema: z.object({
                action: z.enum(['list', 'update']).describe('list = show team tasks; update = change one task'),
                taskId: z.string().min(1).optional().describe('Required for action=update'),
                status: z.enum(['todo', 'doing', 'done', 'blocked']).optional().describe('New status'),
                deliverable: z.string().min(1).max(2000).optional().describe('Evidence for done: branch/commit/files/test result'),
                dependsOn: z.array(z.string().min(1)).max(20).optional().describe('Task ids that must be done first'),
            }),
        }, async (args: { action: 'list' | 'update'; taskId?: string; status?: 'todo' | 'doing' | 'done' | 'blocked'; deliverable?: string; dependsOn?: string[] }) => {
            try {
                const status = await requireTeam();
                if (args.action === 'list') {
                    return { content: [{ type: 'text' as const, text: formatTeamTasks(status.tasks, client.sessionId) }], isError: false };
                }
                if (!args.taskId) {
                    return { content: [{ type: 'text' as const, text: 'taskId is required for action=update' }], isError: true };
                }
                const task = await updateTeamTask({
                    sessionId: client.sessionId,
                    teamId: status.team.id,
                    taskId: args.taskId,
                    status: args.status,
                    deliverable: args.deliverable,
                    dependsOn: args.dependsOn
                });
                return { content: [{ type: 'text' as const, text: `任务「${task?.title ?? args.taskId}」已更新为 ${task?.status ?? 'ok'}` }], isError: false };
            } catch (error) {
                return { content: [{ type: 'text' as const, text: `Failed to update task: ${teamErrorText(error)}` }], isError: true };
            }
        });
    }


    if (skillLookup) {
        mcp.registerTool<any, any>('skill_lookup', {
            description: 'Load a HAPI skill by exact name. When a user message starts with $name, call this tool with that name before acting.',
            title: 'Look Up Skill',
            inputSchema: skillLookupInputSchema,
        }, async (args: { name: string }) => {
            logger.debug('[hapiMCP] Looking up skill:', args.name);
            try {
                const skill = await resolveSkill(args.name, skillLookup.workingDirectory, {
                    flavor: skillLookup.flavor
                });
                if (!skill) {
                    throw new Error(`Skill not found: ${args.name}`);
                }

                const header = [
                    `Skill: ${skill.name}`,
                    ...(skill.description ? [`Description: ${skill.description}`] : [])
                ].join('\n');
                return {
                    content: [
                        {
                            type: 'text' as const,
                            text: `${header}\n\n${skill.body}`,
                        },
                    ],
                    isError: false,
                };
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                logger.debug('[hapiMCP] Failed to look up skill:', message);
                return {
                    content: [
                        {
                            type: 'text' as const,
                            text: `Failed to look up skill: ${message}`,
                        },
                    ],
                    isError: true,
                };
            }
        });
    }

    return mcp;
}

function readMcpSessionId(req: IncomingMessage): string | undefined {
    const raw = req.headers['mcp-session-id'];
    if (typeof raw === 'string') {
        return raw;
    }
    if (Array.isArray(raw)) {
        return raw[0];
    }
    return undefined;
}

export async function startHappyServer(client: ApiSessionClient, options: StartHappyServerOptions = {}) {
    const emitTitleSummary = options.emitTitleSummary ?? true;
    const enableChangeTitle = options.enableChangeTitle ?? true;
    // Team tools are registered only when the hub reports the feature enabled
    // (probe -> 404 when disabled, so nothing changes for non-team hubs).
    // Membership itself is resolved per tool call, so mid-life team joins work.
    const teamToolsEnabled = await probeTeamsSupport();
    const transports = new Map<string, StreamableHTTPServerTransport>();
    const mcps = new Map<string, McpServer>();

    const createMcpTransport = () => {
        const mcp = createHapiMcpServer(client, emitTitleSummary, enableChangeTitle, options.skillLookup, teamToolsEnabled);
        const transport = new StreamableHTTPServerTransport({
            sessionIdGenerator: () => randomUUID(),
            onsessioninitialized: (sessionId) => {
                transports.set(sessionId, transport);
                mcps.set(sessionId, mcp);
            },
            onsessionclosed: (sessionId) => {
                transports.delete(sessionId);
                const server = mcps.get(sessionId);
                mcps.delete(sessionId);
                void server?.close();
            },
        });
        void mcp.connect(transport);
        return transport;
    };

    const server = createServer(async (req, res) => {
        try {
            const sessionId = readMcpSessionId(req);
            const transport = sessionId
                ? transports.get(sessionId)
                : createMcpTransport();

            if (!transport) {
                if (!res.headersSent) {
                    res.writeHead(404).end();
                }
                return;
            }

            await transport.handleRequest(req, res);
        } catch (error) {
            logger.debug("Error handling request:", error);
            if (!res.headersSent) {
                res.writeHead(500).end();
            }
        }
    });

    const baseUrl = await new Promise<URL>((resolve) => {
        server.listen(0, "127.0.0.1", () => {
            const addr = server.address() as AddressInfo;
            resolve(new URL(`http://127.0.0.1:${addr.port}`));
        });
    });

    const mcpUrl = baseUrl.toString();
    client.updateMetadata((metadata) => ({
        ...metadata,
        hapiMcpUrl: mcpUrl,
    }));

    const toolNames = enableChangeTitle
        ? ['change_title', 'display_image', 'display_video', 'display_media', 'list_peers', 'ping_peer', 'inspect_peer']
        : ['display_image', 'display_video', 'display_media', 'list_peers', 'ping_peer', 'inspect_peer'];
    if (teamToolsEnabled) {
        toolNames.push('team_status', 'team_read', 'team_send', 'spawn_peer', 'team_task');
    }
    if (options.skillLookup) {
        toolNames.push('skill_lookup');
    }

    return {
        url: mcpUrl,
        toolNames,
        stop: () => {
            logger.debug('[hapiMCP] Stopping server');
            for (const mcp of mcps.values()) {
                mcp.close();
            }
            transports.clear();
            mcps.clear();
            server.close();
        }
    };
}
