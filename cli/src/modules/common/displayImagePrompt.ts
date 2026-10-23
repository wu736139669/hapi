import { trimIdent } from '@/utils/trimIdent';

const LOCAL_IMAGE_MARKDOWN_HINT = 'Local filesystem paths in Markdown images (for example ![preview](/Users/name/image.png), ![preview](/tmp/image.png), or ![preview](./image.png)) do not send the image to HAPI and can appear broken on the user’s phone. Send local images with the display tool above; only use Markdown images for reachable HTTP(S) image URLs. If the display tool fails, report the failure instead of inserting a local-path Markdown image.';

/**
 * Shared display_image MCP tool hints — one export per tool naming convention.
 * Inject into flavor system prompts and first-prompt bridge instructions.
 */
export const DISPLAY_IMAGE_PROMPT_CLAUDE = trimIdent(`
    When you create or find a local image file that the human user should see, call the tool "mcp__hapi__display_image" with the absolute filesystem path so HAPI can show it inline.
    ${LOCAL_IMAGE_MARKDOWN_HINT}
    This tool sends the image to the human user for inline display in HAPI. It is not an image-reading or image-understanding tool: it does not provide image input to the model and cannot be used to read, inspect, or analyze image contents.
`);

export const DISPLAY_IMAGE_PROMPT_CODEX = trimIdent(`
    When you create or find a local image file that the human user should see, call functions.hapi__display_image with the absolute filesystem path. If that exact tool name is unavailable, use an equivalent alias such as hapi__display_image, mcp__hapi__display_image, or hapi_display_image.
    ${LOCAL_IMAGE_MARKDOWN_HINT}
    This tool sends the image to the human user for inline display in HAPI. It is not an image-reading or image-understanding tool: it does not provide image input to the model and cannot be used to read, inspect, or analyze image contents.
`);

export const DISPLAY_IMAGE_PROMPT_HAPI_MCP = trimIdent(`
    When you create or find a local image file that the human user should see, call the tool "hapi_display_image" with the absolute filesystem path so HAPI can show it inline. If that exact tool name is unavailable, use an equivalent alias such as display_image or mcp__hapi__display_image.
    ${LOCAL_IMAGE_MARKDOWN_HINT}
    This tool sends the image to the human user for inline display in HAPI. It is not an image-reading or image-understanding tool: it does not provide image input to the model and cannot be used to read, inspect, or analyze image contents.
`);

export const DISPLAY_VIDEO_PROMPT_CLAUDE = trimIdent(`
    When you create or find a local mp4 or webm recording the user should see, call the tool "mcp__hapi__display_video" with the file path so HAPI can show it inline.
`);

export const DISPLAY_VIDEO_PROMPT_CODEX = trimIdent(`
    When you create or find a local mp4 or webm file the user should see, call functions.hapi__display_video with the file path. If that exact tool name is unavailable, use an equivalent alias such as hapi__display_video, mcp__hapi__display_video, or hapi_display_video.
`);

export const DISPLAY_VIDEO_PROMPT_HAPI_MCP = trimIdent(`
    When you create or find a local mp4 or webm recording the user should see, call the tool "hapi_display_video" with the file path so HAPI can show it inline. If that exact tool name is unavailable, use an equivalent alias such as display_video or mcp__hapi__display_video.
`);

export const DISPLAY_IMAGE_PROMPT_CURSOR = trimIdent(`
    When you create or find a local image file that the human user should see, call the tool "display_image" with the absolute filesystem path so HAPI can show it inline.
    ${LOCAL_IMAGE_MARKDOWN_HINT}
    This tool sends the image to the human user for inline display in HAPI. It is not an image-reading or image-understanding tool: it does not provide image input to the model and cannot be used to read, inspect, or analyze image contents.
`);

export const DISPLAY_VIDEO_PROMPT_CURSOR = trimIdent(`
    When you create or find a local mp4 or webm recording the user should see, call the tool "display_video" with the absolute filesystem path so HAPI can show it inline.
`);

export const DISPLAY_MEDIA_PROMPT_CLAUDE = trimIdent(`
    When you create or find a local audio file or other non-image file that the user should receive, call the tool "mcp__hapi__display_media" with the file path so HAPI can show a player or download card.
`);

export const DISPLAY_MEDIA_PROMPT_CODEX = trimIdent(`
    When you create or find a local audio file or other non-image file that the user should receive, call functions.hapi__display_media with the file path. If that exact tool name is unavailable, use an equivalent alias such as hapi__display_media, mcp__hapi__display_media, or hapi_display_media.
`);

export const DISPLAY_MEDIA_PROMPT_HAPI_MCP = trimIdent(`
    When you create or find a local audio file or other non-image file that the user should receive, call the tool "hapi_display_media" with the file path. If that exact tool name is unavailable, use an equivalent alias such as display_media or mcp__hapi__display_media.
`);

export const DISPLAY_MEDIA_PROMPT_CURSOR = trimIdent(`
    When you create or find a local audio file or other non-image file that the user should receive, call the tool "display_media" with the absolute filesystem path so HAPI can show a player or download card.
`);
