import { describe, it, expect, afterAll } from 'vitest';
import fs from 'fs';
import {
  materializeAttachment, materializeAttachments, applyAttachmentsToMessages,
  classifyAttachment, MAX_ATTACHMENT_BYTES,
} from '../src/ai/chat-attachments.js';

const tinyPng = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

describe('chat-attachments', () => {
  const created = [];

  afterAll(() => {
    for (const p of created) { try { fs.unlinkSync(p); } catch { /* */ } }
  });

  it('classifies text and image by extension/mime', () => {
    expect(classifyAttachment('notes.txt', 'text/plain')).toBe('text');
    expect(classifyAttachment('photo.PNG', '')).toBe('image');
    expect(classifyAttachment('x.bin', 'application/octet-stream')).toBe('unsupported');
  });

  it('materializes text content', () => {
    const f = materializeAttachment({ name: 'a.txt', content: 'hello world' });
    expect(f.kind).toBe('text');
    expect(f.text).toContain('hello');
  });

  it('materializes image dataUrl to a real path', () => {
    const dataUrl = `data:image/png;base64,${tinyPng.toString('base64')}`;
    const f = materializeAttachment({ name: 'dot.png', dataUrl });
    expect(f.kind).toBe('image');
    expect(f.path).toBeTruthy();
    expect(fs.existsSync(f.path)).toBe(true);
    created.push(f.path);
  });

  it('rejects files over 1 MB', () => {
    const big = Buffer.alloc(MAX_ATTACHMENT_BYTES + 10, 1);
    expect(() => materializeAttachment({
      name: 'big.bin',
      contentBase64: big.toString('base64'),
      mime: 'text/plain',
    })).toThrow(/too large/i);
  });

  it('applyAttachmentsToMessages inlines text and attaches image paths', () => {
    const dataUrl = `data:image/png;base64,${tinyPng.toString('base64')}`;
    const { files } = materializeAttachments([
      { name: 'a.txt', content: 'secret sauce' },
      { name: 'dot.png', dataUrl },
    ]);
    for (const f of files) if (f.path) created.push(f.path);

    const { messages, hasImages } = applyAttachmentsToMessages(
      [{ role: 'user', content: 'what is this?' }],
      files,
    );
    expect(hasImages).toBe(true);
    const user = messages.find(m => m.role === 'user');
    expect(user.content).toMatch(/secret sauce/);
    expect(user.attachments?.length).toBe(1);
    expect(user.attachments[0].path).toBeTruthy();
  });
});
