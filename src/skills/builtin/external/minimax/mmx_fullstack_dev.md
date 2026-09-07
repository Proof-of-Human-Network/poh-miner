---
id: mmx_fullstack_dev
version: 1.0.0
description: |
triggers:
  - fullstack
  - full stack app
  - backend and frontend
---

## Context
# Full-Stack Development Practices

## MANDATORY WORKFLOW — Follow These Steps In Order

**When this skill is triggered, you MUST follow this workflow before writing any code.**

### Step 0: Gather Requirements

Before scaffolding anything, ask the user to clarify (or infer from context):

1. **Stack**: Language/framework for backend and frontend (e.g., Express + React, Django + Vue, Go + HTMX)
2. **Service type**: API-only, full-stack monolith, or microservice?
3. **Database**: SQL (PostgreSQL, SQLite, MySQL) or NoSQL (MongoDB, Redis)?
4. **Integration**: REST, GraphQL, tRPC, or gRPC?
5. **Real-time**: Needed? If yes — SSE, WebSocket, or polling?
6. **Auth**: Needed? If yes — JWT, session, OAuth, or third-party (Clerk, Auth.js)?

If the user has already specified these in their request, skip asking and proceed.

### Step 1: Architectural Decisions

Based on requirements, make and state these decisions before coding:

| Decision | Options | Reference |
|----------|---------|-----------|
| Project structure | Feature-first (recommended) vs layer-first | [Section 1](#1-project-structure--layering-critical) |
| API client approach | Typed fetch / React Query / tRPC / OpenAPI codegen | [Section 5](#5-api-client-patterns-medium) |
| Auth strategy | JWT + refresh / session / third-party | [Section 6](#6-authentication--middleware-high) |
| Real-time method | Polling / SSE / WebSocket | [Section 11](#11-real-time-patterns-medium) |
| Error handling | Typed error hierarchy + global handler | [Section 3](#3-error-handling--resilience-high) |

Briefly explain each choice (1 sentence per decision).

### Step 2: Scaffold with Checklist

Use the appropriate checklist below. Ensure ALL checked items are implemented — do not skip any.

### Step 3: Implement Following Patterns

Write code following the patterns in this document. Reference specific sections as you implement each part.

### Step 4: Test & Verify

After implementation, run these checks before claiming completion:

1. **Build check**: Ensure both backend and frontend compile without errors
   ```bash
   # Backend
   cd server && npm run build
   # Frontend
   cd client && npm run build
   ```
2. **Start & smoke test**: Start the server, verify key endpoints return expected responses
   ```bash
   # Start server, then test
   curl http://localhost:3000/health
   curl http://localhost:3000/api/<resource>
   ```
3. **Integration check**: Verify frontend can connect to backend (CORS, API base URL, auth flow)
4. **Real-time check** (if applicable): Open two browser tabs, verify changes sync

If any check fails, fix the issue before proceeding.

### Step 5: Handoff Summary

Provide a brief summary to the user:

- **What was built**: List of implemented features and endpoints
- **How to run**: Exact commands to start backend and frontend
- **What's missing / next steps**: Any deferred items, known limitations, or recommended improvements
- **Key files**: List the most important files the user should know about

---

## Scope

**USE this skill when:**
- Building a full-stack application (backend + frontend)
- Scaffolding a new backend service or API
- Designing service layers and module boundaries
- Implementing database access, caching, or background jobs
- Writing error handling, logging, or configuration management
- Reviewing backend code for architectural issues
- Hardening for production
- Setting up API clients, auth flows, file uploads, or real-time features

**NOT for:**
- Pure frontend/UI concerns (use your frontend framework's docs)
- Pure database schema design without backend context

---

## Quick Start — New Backend Service Checklist

- [ ] Project scaffolded with **feature-first** structure
- [ ] Configuration **centralized**, env vars **validated at startup** (fail fast)
- [ ] **Typed error hierarchy** defined (not generic `Error`)
- [ ] **Global error handler** middleware
- [ ] **Structured JSON logging** with request ID propagation
- [ ] Database: **migrations** set up, **connection pooling** configured
- [ ] **Input validation** on all endpoints (Zod / Pydantic / Go validator)
- [ ] **Authentication middleware** in place
- [ ] **Health check** endpoints (`/health`, `/ready`)
- [ ] **Graceful shutdown** handling (SIGTERM)
- [ ] **CORS** configured (explicit origins, not `*`)
- [ ] **Security headers** (helmet or equivalent)
- [ ] `.env.example` committed (no real secrets)

## Quick Start — Frontend-Backend Integration Checklist

- [ ] **API client** configured (typed fetch wrapper, React Query, tRPC, or OpenAPI generated)
- [ ] **Base URL** from environment variable (not hardcoded)
- [ ] **Auth token** attached to requests automatically (interceptor / middleware)
- [ ] **Error handling** — API errors mapped to user-facing messages
- [ ] **Loading states** handled (skeleton/spinner, not blank screen)
- [ ] **Type safety** across the boundary (shared types, OpenAPI, or tRPC)
- [ ] **CORS** configured with explicit origins (not `*` in production)
- [ ] **Refresh token** flow implemented (httpOnly cookie + transparent retry on 401)

---

## Quick Navigation

| Need to… | Jump to |
|----------|---------|
| Organize project folders | [1. Project Structure](#1-project-structure--layering-critical) |
| Manage config + secrets | [2. Configuration](#2-configuration--environment-critical) |
| Handle errors properly | [3. Error Handling](#3-error-handling--resilience-high) |
| Write database code | [4. Database Access Patterns](#4-database-access-patterns-high) |
| Set up API client from frontend | [5. API Client Patterns](#5-api-client-patterns-medium) |
| Add auth middleware | [6. Auth & Middleware](#6-authentication--middleware-high) |
| Set up logging | [7. Logging & Observability](#7-logging--observability-medium-high) |
| Add background jobs | [8. Background Jobs](#8-background-jobs--async-medium) |
| Implement caching | [9. Caching](#9-caching-patterns-medium) |
| Upload files (presigned URL, multipart) | [10. File Upload Patterns](#10-file-upload-patterns-medium) |
| Add real-time features (SSE, WebSocket) | [11. Real-Time Patterns](#11-real-time-patterns-medium) |
| Handle API errors in frontend UI | [12. Cross-Boundary Error Handling](#12-cross-boundary-error-handling-medium) |
| Harden for production | [13. Production Hardening](#13-production-hardening-medium) |
| Design API endpoints | `api design` (reference not bundled) |
| Design database schema | `db schema` (reference not bundled) |
| Auth flow (JWT, refresh, Next.js SSR, RBAC) | `auth flow` (reference not bundled) |
| CORS, env vars, environment management | `environment management` (reference not bundled) |

---

## Core Principles (7 Iron Rules)

```
1. ✅ Organize by FEATURE, not by technical layer
2. ✅ Controllers never contain business logic
3. ✅ Services never import HTTP request/response types
4. ✅ All config from env vars, validated at startup, fail fast
5. ✅ Every error is typed, logged, and returns consistent format
6. ✅ All input validated at the boundary — trust nothing from client
7. ✅ Structured JSON logging with request ID — not console.log
```

---
---
Source: `MiniMax-AI/skills` — MIT, (c) MiniMax-AI.
Condensed for the node's prompt budget. For the untruncated skill, fetch
`skills/fullstack-dev/SKILL.md` from `MiniMax-AI/skills` with the `gitmcp` MCP.
