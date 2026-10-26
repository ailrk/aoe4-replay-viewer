# Aoe4 replay viewer

<img alt="Image" src="https://github.com/user-attachments/assets/99ade0f9-abdc-4a04-85ec-226977a9b31c" />

## How to use

Go to aoe4 world and find a match summary, the url looks something like this:

> https://aoe4world.com/players/7614140-VES-Msn-pl/games/256583577?sig=7a58e9a42659146b9fda2bbc07e1d48c4f00d97c

where `7614140` is the player id and `256583577` is the game id. You can input
these two ids directly in the site or pass them as query parameters. The
following is an example match:

> https://ailrk.github.io/aoe4-replay-viewer/?matchId=256583577&profileId=7614140#map


## Limitation

This replay viewer is based on replay file, You can see the click pattern,
A-move pattern, and rally point, but it doesn't come with the map generation,
unit movement and destruction. This means you will see buildings that should be
destroyed remained, sometimes there are duplicated landmarks because the first
one was canceled.

The age up is estimated, so there will be a small error compare to the actual
age up time.

So far these issues are hard to overcome. Replay file only track user commands,
not the game state. Unless we can cook up somthing that simulates the AOE4 game
logic itself, which will be another project.
