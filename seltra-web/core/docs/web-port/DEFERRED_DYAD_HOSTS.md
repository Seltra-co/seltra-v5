# Deferred Dyad-host dependencies

Record only. M5 does not rewire these dependencies.

| File / call site                                                                                 | Host                                                | Purpose                                         | Web mode reaches it | Trace status                                             |
| ------------------------------------------------------------------------------------------------ | --------------------------------------------------- | ----------------------------------------------- | ------------------- | -------------------------------------------------------- |
| `src/pro/main/ipc/handlers/local_agent/tools/web_search.ts` (`engineFetch`, `/tools/web-search`) | `engine.dyad.sh` via configured engine base URL     | Dyad Pro web search tool                        | NOT TRACED          | VERIFIED call site; runtime reachability not traced      |
| `src/pro/main/ipc/handlers/local_agent/tools/web_fetch.ts` (`engineFetch`, `/tools/web-crawl`)   | `engine.dyad.sh` via configured engine base URL     | Dyad Pro fetch tool                             | NOT TRACED          | VERIFIED call site; runtime reachability not traced      |
| `src/pro/main/ipc/handlers/local_agent/tools/web_crawl.ts`                                       | `engine.dyad.sh` via configured engine base URL     | Dyad Pro bounded crawl tool                     | NOT TRACED          | NOT TRACED                                               |
| `src/pro/main/ipc/handlers/themes_handlers.ts` (`/tools/web-crawl`)                              | `engine.dyad.sh` via configured engine base URL     | Pro theme generation from a crawled site        | NOT TRACED          | VERIFIED call site; web-mode reachability not traced     |
| GitHub/Vercel web connection flows                                                               | OAuth/provider hosts to be confirmed from each flow | Account connection and deployment authorization | NOT TRACED          | NOT TRACED; F4 inventory and callback path not completed |
