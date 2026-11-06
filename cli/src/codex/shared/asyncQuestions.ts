import type { ApiSessionClient } from '@/api/apiSession';
import { isIndeterminateError } from '../codexAppServerClient';
import type { PermissionReply } from './permissions';
import { record, string } from './gateway';

type AsyncSubQuestion = {
    questionItemId: string;
    title: string;
    options: string[];
};

type AsyncQuestion = {
    id: string;
    threadId: string;
    itemId: string;
    questions: AsyncSubQuestion[];
    input: {
        isBlocking: false;
        questions: Array<{ id: string; question: string; isOther: true; options: Array<{ label: string; description: string }> }>;
    };
};

function requestId(threadId: string, itemId: string): string {
    return `codex-async-question:${JSON.stringify([threadId, itemId])}`;
}

function itemIdFromQuestionItemId(questionItemId: string): string | undefined {
    try {
        const parsed: unknown = JSON.parse(questionItemId);
        return Array.isArray(parsed) && typeof parsed[1] === 'string' ? parsed[1] : undefined;
    } catch {
        return undefined;
    }
}

export function asyncQuestionReplies(text: string): Array<{ questionItemId: string; question?: string; answer: string }> {
    const opening = '<send_user_message_question_reply>';
    const closing = '</send_user_message_question_reply>';
    text = text.trim();
    if (!text.startsWith(opening) || !text.endsWith(closing)) return [];
    let replies: unknown;
    try { replies = JSON.parse(text.slice(opening.length, -closing.length)); } catch { return []; }
    return (Array.isArray(replies) ? replies : [replies]).flatMap(reply => {
        const parsed = record(reply);
        const questionItemId = string(parsed.questionItemId);
        return questionItemId && typeof parsed.answer === 'string'
            ? [{ questionItemId, question: string(parsed.question), answer: parsed.answer }] : [];
    });
}

/** Async questions are agentMessage items, not requestUserInput server requests. */
export function asyncQuestionsForItem(threadId: string, value: unknown): AsyncQuestion[] {
    const item = record(value);
    const itemId = string(item.id);
    if (item.type !== 'agentMessage' || item.delivery !== 'async' || !itemId || !Array.isArray(item.questions)) return [];
    const questions = item.questions.flatMap((value, index) => {
        const question = record(value);
        const title = string(question.title);
        if (!title) return [];
        const options = Array.isArray(question.options) ? question.options.filter((option): option is string => typeof option === 'string') : [];
        // This is the native TUI's identity, including the index within a batch.
        const questionItemId = JSON.stringify(['request_user_input_async', itemId, index]);
        return [{ questionItemId, title, options }];
    });
    if (questions.length === 0) return [];
    return [{
        id: requestId(threadId, itemId),
        threadId,
        itemId,
        questions,
        input: {
            isBlocking: false as const,
            questions: questions.map(question => ({
                id: question.questionItemId,
                question: question.title,
                isOther: true as const,
                options: question.options.map(label => ({ label, description: '' }))
            }))
        }
    }];
}

type Pending = { question: AsyncQuestion; submitted: boolean };
type Resolution =
    | { status: 'resolved'; answers: Map<string, string> }
    | { status: 'canceled' };

/** Reuses the existing question UI; replies are native user input, never RPC responses. */
export class SharedCodexAsyncQuestions {
    private readonly pending = new Map<string, Pending>();
    private readonly questions = new Map<string, AsyncQuestion>();
    private readonly completed = new Map<string, Resolution>();
    private closed = false;

    constructor(private readonly session: ApiSessionClient,
        private readonly submit: (threadId: string, text: string, clientUserMessageId: string) => Promise<void>) {}

    observeItem(threadId: string, value: unknown): void {
        if (this.closed) return;
        const item = record(value);
        if (item.type === 'userMessage' && Array.isArray(item.content)) {
            const byGroup = new Map<string, Map<string, string>>();
            for (const part of item.content) {
                if (record(part).type !== 'text') continue;
                for (const reply of asyncQuestionReplies(string(record(part).text) ?? '')) {
                    const nativeItemId = itemIdFromQuestionItemId(reply.questionItemId);
                    if (!nativeItemId) continue;
                    const id = requestId(threadId, nativeItemId);
                    const answers = byGroup.get(id) ?? new Map<string, string>();
                    answers.set(reply.questionItemId, reply.answer);
                    byGroup.set(id, answers);
                }
            }
            for (const [id, answers] of byGroup) {
                const previous = this.completed.get(id);
                const merged = new Map(previous?.status === 'resolved' ? previous.answers : []);
                for (const [questionItemId, answer] of answers) merged.set(questionItemId, answer);
                const resolution: Resolution = { status: 'resolved', answers: merged };
                this.completed.set(id, resolution);
                const question = this.questions.get(id);
                if (question) this.resolve(question, resolution);
            }
        }
        for (const question of asyncQuestionsForItem(threadId, item)) {
            this.questions.set(question.id, question);
            const resolution = this.completed.get(question.id);
            if (resolution) { this.resolve(question, resolution); continue; }
            if (this.pending.has(question.id)) continue;
            this.pending.set(question.id, { question, submitted: false });
            this.session.updateAgentState(state => {
                const completedRequests = { ...state.completedRequests };
                delete completedRequests[question.id];
                return { ...state, completedRequests, requests: { ...state.requests, [question.id]: {
                    tool: 'request_user_input', toolCallId: question.id, arguments: question.input,
                    createdAt: typeof item.completedAtMs === 'number' ? item.completedAtMs : Date.now()
                } } };
            });
        }
    }

    /** Read answers first so replay never briefly resurrects answered questions. */
    history(threadId: string, thread: unknown): void {
        const turns = record(thread).turns;
        if (!Array.isArray(turns)) return;
        for (const turn of turns) {
            const items = record(turn).items;
            if (!Array.isArray(items)) continue;
            for (const item of items) if (record(item).type === 'userMessage') this.observeItem(threadId, item);
        }
    }

    async answer(reply: PermissionReply): Promise<boolean> {
        const pending = this.pending.get(reply.id);
        if (!pending) return false;
        if (this.closed || pending.submitted) throw new Error('Question already submitted or unavailable');
        const question = pending.question;
        if (!reply.approved) {
            // Dismissing an optional follow-up must not interrupt the running turn.
            this.completed.set(question.id, { status: 'canceled' });
            this.resolve(question, { status: 'canceled' });
            return true;
        }
        const answers = question.questions.map(sub => {
            const raw = reply.answers?.[sub.questionItemId];
            const values = Array.isArray(raw) ? raw : raw?.answers;
            if (!values?.length) throw new Error('An answer is required');
            const answer = values.filter(value => value !== 'None of the above' || sub.options.includes(value))
                .map(value => !sub.options.includes(value) && value.startsWith('user_note: ') ? value.slice('user_note: '.length) : value)
                .join('\n');
            if (!answer.trim()) throw new Error('An answer is required');
            return { answer, question: sub.title, questionItemId: sub.questionItemId };
        });
        const text = `<send_user_message_question_reply>\n${JSON.stringify(answers)}\n</send_user_message_question_reply>`;
        pending.submitted = true;
        try {
            await this.submit(question.threadId, text, `${question.id}:answer`);
        } catch (error) {
            // A lost acknowledgement cannot authorize another copy of the answer.
            if (!isIndeterminateError(error)) pending.submitted = false;
            throw error;
        }
        // Native input/history, including an answer from another surface, settles
        // the card. Acceptance alone does not prove the answer was consumed.
        return true;
    }

    private resolve(question: AsyncQuestion, resolution: Resolution, emitResult = true): void {
        this.pending.delete(question.id);
        const answers = resolution.status === 'resolved' ? Object.fromEntries(
            question.questions.flatMap(sub => {
                const answer = resolution.answers.get(sub.questionItemId);
                return answer === undefined ? [] : [[sub.questionItemId, {
                    answers: [sub.options.includes(answer) ? answer : `user_note: ${answer}`]
                }]];
            })
        ) : undefined;
        const id = `codex:${question.threadId}:${question.id}:${resolution.status}`;
        const message = { type: 'tool-call-result', callId: question.id, output: { status: resolution.status, ...(answers ? { answers } : {}) }, id };
        const rootThreadId = this.session.getMetadata()?.codexSessionId;
        if (emitResult) this.session.sendAgentMessage(rootThreadId && rootThreadId !== question.threadId ? {
            type: 'agent-run-trace', agentId: question.threadId, cardId: `codex-agent:${question.threadId}`, message, id,
            scope: { role: 'child', threadId: question.threadId, parentThreadId: rootThreadId }, scope_role: 'child'
        } : message, id);
        this.session.updateAgentState(state => {
            const requests = { ...state.requests };
            const prior = requests[question.id] ?? state.completedRequests?.[question.id];
            delete requests[question.id];
            return { ...state, requests, completedRequests: { ...state.completedRequests, [question.id]: {
                tool: 'request_user_input', toolCallId: question.id, arguments: question.input,
                createdAt: prior?.createdAt, completedAt: state.completedRequests?.[question.id]?.completedAt ?? Date.now(),
                status: resolution.status, ...(answers ? { answers } : {})
            } } };
        });
    }

    close(): void {
        this.closed = true;
        // These questions still exist natively and can be restored on resume.
        // Withdraw controls without persisting a false native completion.
        for (const { question } of this.pending.values()) this.resolve(question, { status: 'canceled' }, false);
    }
}
