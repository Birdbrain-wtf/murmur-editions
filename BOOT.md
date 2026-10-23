# How Murmur starts a network

A new person should go from an invite to a member of a running network without being asked to do anything their group does not already do. These are the steps, in order, with what works today.

| Step | What happens | Today |
| --- | --- | --- |
| 1. Invite | Someone already in the network sends you a link. The link carries who invited you, which is the first edge in the record. | Works, on the web. |
| 2. Seed | You make your Seed: a passkey on your own phone or laptop that holds your key. Nobody else holds it, and no name is needed. | Works at [birdbrain.wtf/wallet](https://birdbrain.wtf/wallet). Not yet inside the app. |
| 3. Turn up | You join your group's next session. Signing in to the session is the attendance record; you become a participant. | Works for Chaos Sessions, from the app's meet plugin. |
| 4. Become a member | Keep turning up alongside the same people. Membership is worked out from that, under the [Seeds](https://github.com/Birdbrain-wtf/seeds) rules. Nobody votes you in. | The rules run on the Seeds reference chain. Live admission waits on the network's first members. |
| 5. Your own server | Connect a server you control. Your notes move there, and the group's memory is answered from it. | Not built. The installer for the server side exists; the app does not run it yet. |
| 6. Keep the record | Members can run a node that keeps the shared record. | Works by hand, from an invite. Not yet from the app. |

Steps 1 to 4 are the network. Steps 5 and 6 are what make it the members' own rather than ours.
