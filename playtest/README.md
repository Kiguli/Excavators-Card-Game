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

## Rule options to playtest

The table starts with the default rules below, which tested best. The setup screen's "Rule options to playtest" panel can change any of them, and "Reset to v1" goes back to the written v1 rules.

| Option | Choices | Default |
|---|---|---|
| Junk cards | 20 Junk and 32 Rocks, or 5 Junk and 47 Rocks | 5 Junk |
| Junk trade | Off, or 5 Junk buy one tool | Off (moot with 5 Junk) |
| Rock trades | 3 Rocks for a tool, or the ladder (3 for 1 tool, 5 for 2, 7 for 3, 9 for a Gem) | Ladder |
| Starting tools | 1, 3 or 5 | 3 |
| Dice | 2, or 1 | 2 |
| Claim Jump | Before the rival rolls, or after seeing the roll | After the roll |
| Gems from the Dig | Keep your own Gem, or every Gem goes to the bottom | Every Gem goes to the bottom |
| Drill tools (dig the top card, keep your own Gem) | None, 2 or 4 in each tool deck | 2 |

`src/variants_test.js` plays 4,000 Hard-against-Hard games (and Hard against Medium and Easy) for each rule set and prints game length, skill and luck measures.

## Files

- `src/engine.js`: the rules and the three AI levels. Every decision goes through `game.ask()`, so a seat can be a person or a bot.
- `src/ui.js`, `src/template.html`: the table, the phase guidance bar and the card preview.
- `build.py`: inlines the sources into `index.html` (standalone page) and `artifact.html` (the same page without the document skeleton). Run `python3 build.py` after editing `src/`.
- `src/bots_test.js`: bot-against-bot win rates. `src/fuzz_test.js`: 3,000 games with a random person, to catch rule bugs. Run each with `node`.
- `src/variants_test.js`: the rule-option comparison above.
