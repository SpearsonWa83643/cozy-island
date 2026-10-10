# Cozy Island: design research (treasure, wardrobe, foraging, friends, visuals)

## Chosen design (TL;DR)

- **Treasure loop:** one active **treasure map** at a time. The first map is in a **message bottle** on the beach near spawn. A map is a parchment overlay drawn from the real island heightfield (coast ink line, hatched peak, tree stamps, landmark icons) showing a **torn fragment** around the target, with a **red X**, a **compass rose** and a one-line hand-written clue ("among the maples east of the meadow"). Cues get stronger as you get closer: map "you are here" arrow inside the fragment, then a **warmer/colder chime** (pitch and rate rise as you approach, about every 2 s within 30 m), then a **sparkle column** (<14 m), then a visible **star-crack dig spot** (<8 m), then **Dig**. Digging (dirt puffs, thud) raises a **chest**, then **Open**: lid pops with an elastic ease, confetti, a chime arpeggio, and a reward card with rarity colour. The chest always contains **one wearable plus the next map**. Spots are procedural, rotate through biomes, sit at least 25 m from the previous spot, and are endless. Rarity odds improve slightly with chests opened, with a **pity rule** (rare or better at least every 4th chest).
- **Wardrobe:** 40 procedural low-poly wearables across 6 slots (hat, face, neck, back, body pattern, sprout), with 5 rarity tiers (Common grey, Uncommon green, Rare blue, Epic purple, Legendary gold). **Duplicates become shells 🐚** (2/4/8/15/30 by tier), and shells buy **dyes** (body colours) in the wardrobe, which gives a deterministic sink so no drop is wasted. UI: bottom sheet on iPad, side panel on desktop, a live rotating 3D preview of the character, slot tabs, rarity-coloured cards, "NEW" badges, tap to equip and tap again to unequip.
- **Foraging:** about 10 foods tied to biome plants, lying on the ground under trees or on bushes: apples (oaks), cherries (blossoms), berries (berry and blueberry bushes, hibiscus), acorns (maples and birches), mushrooms (toadstools, brown caps), pinecones (pines), coconuts (palms), cactus fruit (prickly pear and saguaro), seeds (sunflowers), reeds/clover (marsh). Walk up, then **Pick** (button, E, or click/tap the item). The item pops, flies to the bag icon and plays a soft pluck. Items respawn after 2-4 minutes. The bag sheet shows counts.
- **Friends:** ground animals have hunger and preferences (bunny: berries/clover favourite, deer: apples/acorns, duck: seeds/reeds, crab: coconut, …). While you carry something they like, they stop fleeing and get curious. **Feed** gives a heart burst; a favourite food befriends instantly, a liked food fills 50% (two feeds). Friends follow using a **Pikmin/JRPG breadcrumb trail** (each follower targets a point i×spacing behind the player on the recorded path) plus **Reynolds arrival + separation** so they never clip into you or each other. Max 6 followers. After about 5 minutes a friend gets hungry (💭 emote). Feeding it again keeps it, otherwise it waves off after 60 s. Each friend can also be dismissed from the bag sheet.
- **Context action:** one big button on iPad (bottom right, 88 pt) whose icon and label change (🫳 Pick, 🥕 Feed, ⛏️ Dig, 🎁 Open, 🍾 Take). On desktop it is **E** or clicking near the target. Priority: Open > Dig > Take > Feed > Pick. Top bar buttons: 🗺️ Map (M), 🎒 Bag (I), 👕 Wardrobe (O). All targets are at least 44 pt. Sheets slide up with a spring ease, and camera gestures are blocked while a sheet is open.
- **Save:** localStorage, versioned (`cozyIsland.save.v1`). Stores inventory, shells, owned, new and equipped wearables, dyes, map index, seed, current spot and dug state, chests opened, and placed builds.
- **Visuals (cheap wins first):** a TSL **terrain detail layer** (2-octave world-space noise for grain plus per-biome patterns: sand ripples, snow sparkle, grass clumps, mesa strata on slopes), subtle **world-noise variation on flora** (bark/rock/leaf grain), **rim light** plus fake **foliage translucency** (backlit canopy glow) as emissive terms, **baked AO** in vertex colours (plant bases darker, terrain darkened under trees), and **chunked instancing** (3×3 regions) so frustum and shadow culling work on iPad Low. No SSAO/GTAO on mobile.

---

## 1. Treasure maps in cozy/exploration games

| Game | Clue style | What we take |
|---|---|---|
| **A Short Hike** | 4 riddle maps that point to readable landmarks ("tip of the lighthouse's shadow", "throne-shaped rock", view through a rock arch), then dig. Maps are side content, never gating. | Clues reference **landmarks the player can recognise**; reward curiosity; keep it optional and low-pressure. |
| **Sea of Thieves (X Marks the Spot)** | Sketch of the island with an X; the player matches **landmarks and compass**; a dull thud when you dig the right spot. **Riddle maps** reveal lines progressively. | The **sketch-of-the-real-island** style, a compass rose, and a confirming audio cue at the spot. Progressive reveal → our map fragment plus "you are here" arrow once you're in the area. |
| **Zelda BotW Korok seeds** | Hidden in "suspicious" spots (odd rock formations, the "triangle rule": things hidden behind hills/landmarks). Designers found plain rocks unrewarding, so they added a creature with personality. The **Korok Mask** shakes when you're near (proximity cue). | Hide chests near interesting features (groves, mesa edges, pond shore, peak). Make the find itself delightful (animation, sound), plus a proximity "warmer" cue. |
| **Animal Crossing NH fossils** | Star-shaped cracks as dig spots; **4 per day, cap 6**; duplicates sell. Clear, readable dig marker. | The **star-crack dig spot** visual. Duplicates are never worthless (→ shells). Steady, bounded cadence. |
| Alba / Ooblets / Tiny Glade | Low-stress, no fail states; collection is about delight, not grind. | No timers or penalties; every chest is a win. |

**Pacing and anti-frustration:** escalating cues (map → chime → sparkles → crack → dig), so a player who wanders in the right biome always gets there. Within a fragment the map shows your position (players get lost on featureless low-poly terrain otherwise). Reward cadence: a chest every about 3-5 minutes of exploring. The next map comes with every chest, so the loop is endless; spots rotate biomes so the whole island gets visited.

## 2. Cosmetic collection loops

- Use a **small, consistent rarity ladder with fixed colours** (Bongo Cat catalogue: common grey, uncommon green, rare blue, epic purple, legendary gold). Players read the colour before the name.
- **Duplicates must have value** (Overwatch dust, CS:GO wear, Heroic Labs "token" pattern; mobilefreetoplay: "make duplicates celebrated, not regretted"). A deterministic sink (dust shop) builds trust. Never auto-convert the last copy.
- Typical loot-table guidance: guarantee a floor ("dignity floor") plus **pity** so the worst case is bounded.
- **Wardrobe UX:** owned vs locked (silhouette) cards, filters per slot, collection progress (x/40), equip with preview on the avatar, "NEW" badges until viewed.
- **Procedural low-poly wearables:** built from primitives in the existing vertex-colour style (Baker): hats (straw, beanie, flower crown, crown, wizard, pirate, frog, mushroom cap, chef, party, viking, halo), face (round/star/heart/sun glasses, monocle, mustache, blush, mask), neck (scarves in colours, bandana, bell collar, lei, bowtie), back (backpacks, leaf/petal/bat/butterfly wings, cape, shell, balloon), body (stripes, dots, overalls, hoodie colours), sprout (leaf, flower, double leaf, cherry, star, flame). Colours and patterns make cheap variety.

## 3. Foraging, feeding and befriending

- **Stardew:** a repeatable care loop (feed daily, pet, hearts 0-5) where friendship goes up with care and decays with neglect, so keep hunger soft. **Alba:** readable silhouettes and lifelike, gentle animation; observation over ownership. **Animal Crossing:** fruit that visibly sits on and under trees, respawning, with a pocket inventory with counts.
- **Followers:** Reynolds' *leader following* is arrival at a point behind the leader, plus separation, plus sidestepping out of the leader's path. JRPG/Pikmin trails use a **breadcrumb buffer** of past leader positions, where follower *i* samples the path at distance *i·spacing*. That gives stable, natural spacing that follows the route you walked (around trees), so we combine both. Ooblets' "followbabies" confirm the delight of a little parade; a cap (6) keeps it readable and cheap.
- **Juice:** heart burst on feed, a little hop of joy, a speech-bubble emote for hunger, soft pluck/pop sounds, fly-to-bag animation for picked items, number tick on the bag badge.

## 4. iPad-first UX

- Apple HIG: **44×44 pt** for primary/frequent controls (28 pt minimum for menus). Bottom sheets with a 44 pt drag handle and actions.
- **No haptics on the web for iOS:** Safari/WebKit has never shipped `navigator.vibrate` (caniuse). So feedback is visual (squash, pop, glow, screen-space flyers) plus audio.
- Contextual single action button (like Animal Crossing's A or A Short Hike's interact prompt) avoids a crowded HUD. Its label and icon change with the nearest target.
- Map as a **fullscreen overlay** with pinch-zoom and pan inside the overlay. Camera input is suspended while any overlay or sheet is open, so gestures never conflict. Overlay and sheet backgrounds swallow pointer events.

## 5. Efficient visuals for three.js WebGPU/TSL (WebGL2 fallback)

- **Triplanar** = 3 fetches per texture; **biplanar** saves 33%. Our terrain is mostly top-down, so **planar XZ procedural noise** plus a slope-based Y-band term (mesa strata, rock) gives the triplanar look for about 2 `mx_noise` evaluations. No texture downloads.
- Avoid per-vertex procedural terrain generation on GPU each frame. We already bake height and colour once on CPU.
- Stylised lighting: **half-Lambert/wrap** and **rim** (`pow(1-N·V, 2..3)`) are a few ALU each. **Bake AO into vertex colours** rather than SSAO: SSAO/GTAO needs depth/normal prepasses and many samples, which is too costly on mobile.
- Foliage: a cheap **backlight/translucency** term (light through leaves when the view looks toward the sun) instead of screen-space SSS.
- Colour grading via LUT is a single post pass. We already have tone mapping and saturation in the High post chain; Low skips post entirely.
- Mobile is usually **fill-rate** bound, then triangles/draw calls. **Chunk instanced meshes by region** so frustum and shadow-camera culling can skip off-screen groups; keep overdraw (transparent mist/particles) small on Low.

### Sources
- A Short Hike maps and postmortem: steamcommunity.com/app/1055540/discussions/0/1639792569834373392; thegamer.com/a-short-hike-every-buried-treasure-secret-location-guide; youtube.com/watch?v=ZW8gWgpptI8
- BotW Korok design and triangle rule: nintendoeverything.com/zelda-breath-of-the-wilds-korok-seeds-were-originally-stone-objects; eurogamer.net/zelda-breath-of-the-wild-development-secrets-revealed; gist.github.com/idbrii/e39fe96279aa1670319bfa521d907399
- Sea of Thieves maps: seaofthieves.wiki.gg/wiki/X_Marks_the_Spot_Map; seaofthieves.wiki.gg/wiki/Riddle_Map
- ACNH fossils/dig spots: nookipedia.com/wiki/Fossil; acnh.isomorphicbox.com/rates
- Rarity, duplicates, pity: teemo.dev/game-design/bongo-cat/systems/the-catalogue; teemo.dev/game-design/concepts/loot-boxes/systems/implementation-blueprint; mobilefreetoplay.com/creating-strong-gacha-pros-make-sure-duplicates-arent-bad-drops; heroiclabs.com/docs/hiro/guides/gameplay-mechanics/gacha
- Animals: teemo.dev/game-design/stardew-valley/systems/animals-and-artisan-goods-reference; whynowgaming.com/how-we-made-alba-a-wildlife-adventure; pcgamer.com (Ooblets followbabies)
- Steering: red3d.com/cwr/steer/gdc99; red3d.com/cwr/steer/LeaderFollow.html; Godot forum follower-trail thread
- iPad UX: developer.apple.com/design/tips; HIG game controls; caniuse.com/vibration
- Rendering: threejs-skills.com/skills/threejs-procedural-materials.html; threejs-blocks.com/docs/biplanarTexture; three.js webgpu_tsl_procedural_terrain example; masterallarts.com stylized NPR article; threejsroadmap.com/blog/rim-lighting-shader; utsubo.com/blog/threejs-best-practices-100-tips
