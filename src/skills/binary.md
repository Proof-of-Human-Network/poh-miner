---
id: binary
version: 1.0.0
description: Translates any text message into binary code (ASCII 0s and 1s)
allowedEndpoints:
  - '*'
triggers:
  - binary
  - translate to binary
  - convert to binary
  - in binary
---

## Context

Converts any text to its binary (ASCII) representation.

Input: `{ text: string }` — the text to encode.

Returns: `{ binary: string, original: string }`

## Code

```js
const text = input.text || input.message || input.query || '';
const binary = text.split('').map(c => c.charCodeAt(0).toString(2).padStart(8, '0')).join(' ');
return { binary, original: text };
```
