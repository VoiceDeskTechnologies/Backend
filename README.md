# HandsFree backend

TypeScript Express API boundary for Render. Add provider credentials from `.env.example` and keep all secrets server-side.

```bash
npm install
npm run dev
npm run build
```

`GET /health` is available without external credentials. Provider adapters return meaningful configuration errors rather than pretending to place calls or generate AI responses.
