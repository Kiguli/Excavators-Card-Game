# Excavators playtest table

A browser version of Excavators (v1 rules, v3 realistic cards) for playtesting against an AI.
You play the red T-rex; the AI plays the blue Iguanodon.

Open `index.html` in a browser, or host this folder as-is (for example as a subpage of a website).
It needs no server code: everything runs in the page, and the card images are in `cards/`.

## AI levels

| Level | How it plays |
|---|---|
| Easy | Takes each legal option half the time, with no plan |
| Medium | Chases its own Gems and Treasures, but never blocks you or buries your Gems |
| Hard | Blocks with Magnets, Demagnetiser, Flooded Shaft and Collapse, buries your Gems, and remembers every card returned to the mine since the last shuffle |

In 2,000 bot-against-bot games each, Hard beats Medium about 76% of the time and Easy about 85%,
which matches the rules simulator in the design notes.

## Rule choices the written rules leave open

- Shovel is played after the dice, during the Magnet exchange.
- A rival's Gem dug from the top of the mine is shown and goes to the bottom, then you dig again.
- The 9-Rock Gem trade puts the Gem in your Warchest and shuffles the mine; you don't dig again.
- The Magnet exchange starts with the rival and goes back and forth until both players pass.

## Files

- `src/engine.js`: the rules and the three AI levels. Every decision goes through `game.ask()`, so a seat can be a person or a bot.
- `src/ui.js`, `src/template.html`: the table, the phase guidance bar and the card preview.
- `build.py`: inlines the sources into `index.html` (standalone page) and `artifact.html` (the same page without the document skeleton). Run `python3 build.py` after editing `src/`.
- `src/bots_test.js`: bot-against-bot win rates. `src/fuzz_test.js`: 3,000 games with a random person, to catch rule bugs. Run each with `node`.
