import { describe, expect, it, vi } from 'vitest';
import type { ApiSessionClient } from '@/api/apiSession';
import type { AgentState } from '@/api/types';
import { INDETERMINATE_SYMBOL } from '../codexAppServerClient';
import { asyncQuestionsForItem, SharedCodexAsyncQuestions } from './asyncQuestions';

const item = { type: 'agentMessage', id: 'call_async', delivery: 'async', text: 'Which client?\n- Web\n- Terminal',
    questions: [{ title: 'Which client?', options: ['Web', 'Terminal'] }, { title: 'Any details?', options: null }] };
const questions = asyncQuestionsForItem('thread', item);
const question = questions[0];
const [clientQuestion, detailsQuestion] = question.questions;
function replyTag(replies: Array<{ questionItemId: string; answer: string; question?: string }>) {
    return { type: 'userMessage', content: [{ type: 'text', text:
        `<send_user_message_question_reply>\n${JSON.stringify(replies)}\n</send_user_message_question_reply>` }] };
}
function nativeReply(client: string, details = 'Details') {
    return replyTag([
        { questionItemId: clientQuestion.questionItemId, answer: client, question: clientQuestion.title },
        { questionItemId: detailsQuestion.questionItemId, answer: details, question: detailsQuestion.title }
    ]);
}
function fixture() {
    let state: AgentState = {};
    const send = vi.fn();
    const session = { getMetadata: () => ({ codexSessionId: 'thread' }), sendAgentMessage: send,
        updateAgentState: (fn: (state: AgentState) => AgentState) => { state = fn(state); }
    } as unknown as ApiSessionClient;
    const submit = vi.fn(async (_threadId: string, _text: string, _id: string) => {});
    const manager = new SharedCodexAsyncQuestions(session, submit);
    return { manager, send, submit, state: () => state };
}

describe('Codex queued follow-up questions', () => {
    it('groups one async item into one multi-question card with native IDs', () => {
        const f = fixture(); f.manager.observeItem('thread', item); f.manager.observeItem('thread', item);
        expect(questions).toHaveLength(1);
        expect(Object.values(f.state().requests!)).toHaveLength(1);
        expect(question.questions.map(q => q.questionItemId)).toEqual([
            '["request_user_input_async","call_async",0]',
            '["request_user_input_async","call_async",1]'
        ]);
        expect(f.state().requests![question.id]).toMatchObject({ tool: 'request_user_input', arguments: {
            isBlocking: false,
            questions: [
                { id: clientQuestion.questionItemId, question: 'Which client?', isOther: true,
                    options: [{ label: 'Web', description: '' }, { label: 'Terminal', description: '' }] },
                { id: detailsQuestion.questionItemId, question: 'Any details?', isOther: true, options: [] }
            ]
        } });
    });

    it.each([['Web'], ['None of the above', 'user_note: Mobile']])('submits all answers in one native user message (%j)', async (...values) => {
        const f = fixture(); f.manager.observeItem('thread', item);
        const answer = values.at(-1)!.replace(/^user_note: /, '');
        await f.manager.answer({
            id: question.id,
            approved: true,
            answers: {
                [clientQuestion.questionItemId]: { answers: values },
                [detailsQuestion.questionItemId]: { answers: ['Details'] }
            }
        });
        expect(f.submit).toHaveBeenCalledWith('thread',
            `<send_user_message_question_reply>\n${JSON.stringify([
                { answer, question: clientQuestion.title, questionItemId: clientQuestion.questionItemId },
                { answer: 'Details', question: detailsQuestion.title, questionItemId: detailsQuestion.questionItemId }
            ])}\n</send_user_message_question_reply>`, `${question.id}:answer`);
        expect(f.state().requests![question.id]).toBeDefined();
        expect(f.state().completedRequests?.[question.id]).toBeUndefined();
        await expect(f.manager.answer({
            id: question.id,
            approved: true,
            answers: {
                [clientQuestion.questionItemId]: ['Web'],
                [detailsQuestion.questionItemId]: ['Details']
            }
        })).rejects.toThrow('already submitted');

        f.manager.observeItem('thread', nativeReply(answer));
        expect(f.state().requests![question.id]).toBeUndefined();
        expect(f.state().completedRequests![question.id]).toMatchObject({ status: 'resolved', answers: {
            [clientQuestion.questionItemId]: { answers: [values.at(-1)] },
            [detailsQuestion.questionItemId]: { answers: ['user_note: Details'] }
        } });
    });

    it('rejects missing/empty answers without submitting and allows a corrected answer', async () => {
        const f = fixture(); f.manager.observeItem('thread', item);
        for (const answers of [
            undefined,
            {},
            { [clientQuestion.questionItemId]: ['Web'] },
            { [clientQuestion.questionItemId]: ['Web'], [detailsQuestion.questionItemId]: ['user_note:  '] }
        ]) {
            await expect(f.manager.answer({ id: question.id, approved: true, answers })).rejects.toThrow('answer is required');
        }
        expect(f.submit).not.toHaveBeenCalled();
        await f.manager.answer({ id: question.id, approved: true, answers: {
            [clientQuestion.questionItemId]: ['Web'],
            [detailsQuestion.questionItemId]: ['Details']
        } });
        expect(f.submit).toHaveBeenCalledOnce();
    });

    it('consumes terminal replies before replay and does not reopen answered questions', async () => {
        const f = fixture();
        const reply = nativeReply('Terminal');
        f.manager.history('thread', { turns: [{ items: [item, reply] }] });
        f.manager.observeItem('thread', item);
        expect(f.state().requests![question.id]).toBeUndefined();
        expect(f.state().completedRequests![question.id].status).toBe('resolved');
        expect(await f.manager.answer({ id: question.id, approved: true, answers: {
            [clientQuestion.questionItemId]: ['Web'],
            [detailsQuestion.questionItemId]: ['Details']
        } })).toBe(false);
        expect(f.submit).not.toHaveBeenCalled();
        f.manager.observeItem('thread', item);
        expect(f.state().requests![question.id]).toBeUndefined();
        expect(f.send.mock.lastCall![0]).toMatchObject({ type: 'tool-call-result', callId: question.id, output: {
            answers: {
                [clientQuestion.questionItemId]: { answers: ['Terminal'] },
                [detailsQuestion.questionItemId]: { answers: ['user_note: Details'] }
            }
        } });
    });

    it('scopes child replies and cards to their own thread', async () => {
        const f = fixture(); f.manager.observeItem('child', item);
        const childQuestion = asyncQuestionsForItem('child', item)[0];
        f.manager.observeItem('thread', nativeReply('Web'));
        expect(f.state().requests![childQuestion.id]).toBeDefined();
        await f.manager.answer({ id: childQuestion.id, approved: true, answers: {
            [clientQuestion.questionItemId]: ['Terminal'],
            [detailsQuestion.questionItemId]: ['Details']
        } });
        expect(f.submit.mock.lastCall![0]).toBe('child');
        f.manager.observeItem('child', nativeReply('Terminal'));
        expect(f.send.mock.lastCall![0]).toMatchObject({ type: 'agent-run-trace', agentId: 'child',
            message: { type: 'tool-call-result', callId: childQuestion.id }, scope: { parentThreadId: 'thread' } });
    });

    it.each([false, true])('retries only definitively rejected submissions (indeterminate: %s)', async indeterminate => {
        const f = fixture(); f.manager.observeItem('thread', item);
        f.submit.mockRejectedValueOnce(Object.assign(new Error('Disconnected'), { [INDETERMINATE_SYMBOL]: indeterminate }));
        const reply = { id: question.id, approved: true, answers: {
            [clientQuestion.questionItemId]: ['Web'],
            [detailsQuestion.questionItemId]: ['Details']
        } };
        await expect(f.manager.answer(reply)).rejects.toThrow('Disconnected');
        if (indeterminate) await expect(f.manager.answer(reply)).rejects.toThrow('already submitted');
        else await f.manager.answer(reply);
        expect(f.submit).toHaveBeenCalledTimes(indeterminate ? 1 : 2);
        expect(f.state().completedRequests?.[question.id]).toBeUndefined();
    });

    it('dismisses an optional question without sending input or interrupting the turn', async () => {
        const f = fixture(); f.manager.observeItem('thread', item);
        await f.manager.answer({ id: question.id, approved: false });
        expect(f.submit).not.toHaveBeenCalled();
        expect(f.state().completedRequests![question.id].status).toBe('canceled');
        f.manager.observeItem('thread', item);
        expect(f.state().requests![question.id]).toBeUndefined();
        f.manager.observeItem('thread', nativeReply('Terminal'));
        expect(f.state().completedRequests![question.id].status).toBe('resolved');
    });

    it('parses literal reply tags inside an answer and ignores quoted or malformed replies', () => {
        const f = fixture(); f.manager.observeItem('thread', item);
        for (const text of ['<send_user_message_question_reply>bad json</send_user_message_question_reply>',
            `Example: ${nativeReply('Web').content[0].text}`]) {
            f.manager.observeItem('thread', { type: 'userMessage', content: [{ type: 'text', text }] });
        }
        expect(f.state().requests![question.id]).toBeDefined();
        const answer = 'Check </send_user_message_question_reply> escaping';
        f.manager.observeItem('thread', replyTag([
            { questionItemId: clientQuestion.questionItemId, answer, question: clientQuestion.title },
            { questionItemId: detailsQuestion.questionItemId, answer: 'Details', question: detailsQuestion.title }
        ]));
        expect(f.state().completedRequests![question.id].answers).toEqual({
            [clientQuestion.questionItemId]: { answers: [`user_note: ${answer}`] },
            [detailsQuestion.questionItemId]: { answers: ['user_note: Details'] }
        });
    });

    it('withdraws controls on exit without persisting a false native result', () => {
        const f = fixture(); f.manager.observeItem('thread', item); f.manager.close();
        expect(f.state().requests).toEqual({});
        expect(f.send).not.toHaveBeenCalled();
        f.manager.observeItem('thread', item);
        expect(f.state().requests).toEqual({});
    });
});
