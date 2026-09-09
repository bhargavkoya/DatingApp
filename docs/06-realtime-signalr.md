# 06 — Realtime (SignalR)

Two hubs, mapped in `Startup.Configure`:
- `MapHub<PresenceHub>("hubs/presence")`
- `MapHub<MessageHub>("hubs/message")`

Both `[Authorize]`. Auth token comes from the **`access_token` query-string** param (see
`05-auth-and-security.md`). Default in-memory backplane — **single API instance only**.

Client base URL: `environment.hubUrl` = `https://localhost:5001/hubs/` (dev).
All client connections use `.withAutomaticReconnect()`.

---

## Presence — `PresenceHub` + `PresenceTracker`

### `PresenceTracker` (singleton, `SignalR/PresenceTracker.cs`)
`static Dictionary<string, List<string>> OnlineUsers` = username → list of connection ids
(a user can have several tabs/devices). All access `lock (OnlineUsers)`.
- `UserConnected(username, connId)` → adds; returns `true` **only if this is the user's first
  connection** (i.e. they just came online).
- `UserDisconnected(username, connId)` → removes; returns `true` **only if that was their last
  connection** (i.e. they just went offline).
- `GetOnlineUsers()` → sorted `string[]` of usernames.
- `GetConnectionsForUser(username)` → `List<string>` connection ids (or null).

⚠️ In-memory + static → wiped on restart, wrong across multiple instances.

### `PresenceHub` (`SignalR/PresenceHub.cs`)
| Lifecycle | Server does | Emits |
|---|---|---|
| `OnConnectedAsync` | `tracker.UserConnected(...)`; then `tracker.GetOnlineUsers()` | if newly online → `Clients.Others → "UserIsOnline"(username)`; always `Clients.Caller → "GetOnlineUsers"(string[])` |
| `OnDisconnectedAsync` | `tracker.UserDisconnected(...)` | if newly offline → `Clients.Others → "UserIsOffline"(username)` |

`MessageHub` (below) also calls `_presenceHub.Clients.Clients(connections).SendAsync(
"NewMessageReceived", { username, knownAs })` to notify an online-but-not-in-this-chat
recipient.

### Client — `PresenceService`
Connects on login and on app start (`AppComponent`). Handlers:
| Event | Handler updates |
|---|---|
| `"UserIsOnline"(username)` | `onlineUsers$` += username |
| `"UserIsOffline"(username)` | `onlineUsers$` −= username |
| `"GetOnlineUsers"(string[])` | `onlineUsers$` = list |
| `"NewMessageReceived"({username, knownAs})` | `toastr.info("<knownAs> has sent you a new message!")`; on tap → `router.navigateByUrl('/members/<username>?tab=3')` |

`onlineUsers$` drives the green "online" dot on member cards / detail.

---

## Messaging — `MessageHub`

### Group model
- A **`Group`** row (PK = `Name`) represents one 1-to-1 conversation. `Name` =
  `GetGroupName(caller, other)` = the two usernames compared with `string.CompareOrdinal`,
  smaller first, joined by `-`. Deterministic regardless of who opens the chat.
- A **`Connection`** row (`ConnectionId`, `Username`) is added to a group's `Connections` when
  a user opens that chat, removed on disconnect.
- "Is the recipient currently looking at this chat?" = does the group's `Connections` contain
  their username.

### `MessageHub` lifecycle
| Step | Server does |
|---|---|
| `OnConnectedAsync` | read `?user=<otherUsername>` from the query; `groupName = GetGroupName(me, other)`; `Groups.AddToGroupAsync(connId, groupName)`; `AddToGroup(groupName)` (creates the `Group` if missing, adds a `Connection`, `Complete()`); `Clients.Group → "UpdatedGroup"(group)`; `MessageRepository.GetMessageThread(me, other)` (this **marks unread→read** in memory); if `HasChanges()` → `Complete()`; `Clients.Caller → "ReceiveMessageThread"(messages)` |
| `SendMessage(CreateMessageDto {recipientUsername, content})` | reject if sending to self (`HubException`); load sender + recipient (`HubException` if recipient null); build `Message`; `groupName = GetGroupName(sender, recipient)`; load group; **if recipient's username is in `group.Connections`** → `message.DateRead = UtcNow` (they're watching); **else** → `tracker.GetConnectionsForUser(recipient)`; if any → presence hub `"NewMessageReceived"({username, knownAs})`; `AddMessage(message)`; `Complete()`; on success `Clients.Group → "NewMessage"(MessageDto)` |
| `OnDisconnectedAsync` | `RemoveFromMessageGroup()` (find group by connection, remove the `Connection`, `Complete()`); `Clients.Group → "UpdatedGroup"(group)`; `base.OnDisconnectedAsync` |

### Client — `MessageService`
`createHubConnection(user, otherUsername)` → `withUrl(hubUrl + 'message?user=' +
otherUsername, { accessTokenFactory })`. Also calls `busyService.busy()` /
`.idle()` around `start()`.

| Event | Handler |
|---|---|
| `"ReceiveMessageThread"(messages)` | `messageThreadSource.next(messages)` |
| `"NewMessage"(message)` | append to `messageThread$` |
| `"UpdatedGroup"(group)` | if `group.connections` contains `otherUsername` → mark every thread message `dateRead = now` and re-emit (visual read receipt) |

`sendMessage(username, content)` → `hubConnection.invoke('SendMessage', { recipientUsername:
username, content })` (returns a promise).
`stopHubConnection()` → `hubConnection.stop()` + clear `messageThread$`.

### Where the message thread comes from
`MemberDetailComponent` opens/closes the message hub when the **Messages tab** is
activated/deactivated (`onTabActivated`) and on `ngOnDestroy`. `MemberMessagesComponent`
(child, `ChangeDetectionStrategy.OnPush`) renders `messageThread$` and calls `sendMessage`.
The REST `GET messages/thread/{username}` on the client exists but the **server endpoint is
commented out** — the thread is SignalR-only.

---

## Event catalogue (names are a hard contract — see `08-invariants-and-contracts.md`)

| Hub | Direction | Event | Payload |
|---|---|---|---|
| presence | S→C (others) | `UserIsOnline` | `string` username |
| presence | S→C (others) | `UserIsOffline` | `string` username |
| presence | S→C (caller) | `GetOnlineUsers` | `string[]` usernames |
| presence | S→C (targeted) | `NewMessageReceived` | `{ username, knownAs }` |
| message | S→C (caller) | `ReceiveMessageThread` | `MessageDto[]` |
| message | S→C (group) | `NewMessage` | `MessageDto` |
| message | S→C (group) | `UpdatedGroup` | `Group { name, connections[] }` |
| message | C→S | `SendMessage` | `{ recipientUsername, content }` |

Connection query params: message hub requires `?user=<otherUsername>`; both hubs require
`?access_token=<jwt>`.
