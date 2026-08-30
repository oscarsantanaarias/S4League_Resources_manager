# Editing S4 models and animations

Two separate viewers ship with the tool. They look similar and do different
things, so start by knowing which one you are in.

| Window title | What it opens | Editor |
|---|---|---|
| `S4 Sequences - visor de .seq` | `.seq` effects and single `.scn` scenes | side panel, tab **Editor** |
| `SCN 3D Preview` | a character (`male_bip.scn` + body parts) | bottom bar, **Pose** |

Open a `.scn` in the resource list: if it is `male_bip.scn` or `female_bip.scn`
you get the character viewer, anything else opens in the sequence viewer.

---

## 1. Character viewer: posing

Open `male_bip.scn` (or `female_bip.scn`). The bottom bar is the pose editor.

### Picking a clip and a moment

The dropdown at the top left lists all 721 clips. `◀` `▶` step through them,
`⏯` pauses. On the bottom bar, `t` scrubs through the clip and the readout shows
`1200 / 3200 ms`.

**Pause before posing.** While the clip plays, whatever you edit scrolls past
before you can look at it.

### Posing a bone

Every bone is a blue sphere, joined to its parent by a red line.

* **Drag a sphere** and the parent bone rotates so the sphere follows the cursor.
  Pull the forearm, the elbow bends.
* **Drag the line** instead of the sphere. A click along a bone grabs *that*
  bone, so you can take a limb anywhere along its length.

### edit whole line

By default a drag rotates one joint. Turn on **edit whole line** and the whole
chain above the grabbed bone bends to follow, so you shape a limb instead of
pivoting it around one elbow.

`chain` next to it is how many bones the solver is allowed to move, 2 to 12.
Four is a good default: for an arm that reaches the shoulder. Raise it and the
spine starts moving too, which is sometimes what you want and often not.

### The frame picker

`key` lists the clip's real keys: `3/15  480 ms`. Pick one and the model jumps
there, playback pauses, and **the range narrows to that single key**. That is
the frame by frame workflow: choose a key, pose, choose the next.

`◀` and `▶` next to it step to the previous or next key. While the clip plays
the list follows the playhead, so it always shows where you are.

A clip does not really store "frames", it stores keys, and different bones can
carry different ones. The list is the union of every key in the clip, which is
exactly the set of moments you can land on and edit.

### The range: which frames get the pose

This is the part that catches people out. A pose is not written to "now", it is
written to **every key inside the range**.

* `from` and `to` are milliseconds.
* **whole clip** sets the range to the entire clip.
* **this tick only** collapses it to the current instant.

The shipped clips carry a key roughly every 240 ms. If your range falls between
two keys it contains none, nothing can be written, and the editor tells you:
`no key between 1500 and 1520 ms, widen the range`. Widen it, use **whole clip**,
or pick the key from the `key` list, which always lands on a real one.

So: to hold a pose across a stretch of the animation, set the range to that
stretch and drag once.

---

## 2. Adding your own bones

**+ bone** then click the model. A green bone drops there, parented to the
nearest existing bone, with a line showing which one. It follows that bone
through every clip.

**- bone** then click near a green bone deletes it.

**Two things they cannot do**, both worth knowing before you plan around them:

* They are not written into the `.scn`. Adding a bone chunk grows the file and
  the codec only patches values in place. They live in a sidecar file,
  `male_bip.userbones.json`, next to the resource you opened.
* They do not deform the mesh. A bone only moves vertices that carry weights
  towards it, and nothing weights to a bone that did not exist when the model
  was made. The shipped `_Dummy` and `ForeTwist` bones are in the same
  situation: they exist, they animate, they deform nothing.

They are useful as anchors and as visible markers, not as new joints.

---

## 3. Linking bones

### One at a time

**link**, then click your bone, then click the bone it should hang off. The
status line walks you through it.

### Several at once

1. **select**
2. Click each bone you want. They turn yellow; the last one turns pink.
3. **join selection**

**The last bone you click is the parent**, everything else hangs off it. Same
convention as Blender's active object, so you can keep clicking children without
re-picking the parent. Clicking a selected bone again deselects it.

**chain all** re-parents every bone of yours to the nearest bone that is not one
of its own descendants, linking them in one go.

### Your bones vs skeleton bones

Both can be re-parented, but they behave differently:

* **Your bones do not move.** The offset is recomputed against the new parent,
  so the bone stays exactly where it is.
* **Skeleton bones jump.** Their position comes from the clip and is expressed
  relative to the parent, so under a new parent the same numbers mean something
  else. There is no offset to recompute. The status line says so when it
  happens.

Cycles are refused rather than accepted and left to hang the viewer.

**undo re-links** puts every re-parented bone back where it started.

---

## 4. Saving

**Save** writes three things:

1. Pose edits into the `.scn`, patched in place.
2. The `.scn` back into the resource you opened, the `.s4hd` container or a
   loose folder, whichever it was.
3. Your bones and re-links into the sidecar JSON.

Then **press "Save changes" in the main tool window**. The editor marks the
resource dirty; the tool is what actually writes the container to disk.

Until you press Save nothing touches the disk. The counter on the bar shows how
many edits are pending: `1200 / 3200 ms - 4 unsaved`.

**discard edits** re-reads the clip from disk and throws away unsaved pose
changes. Use it as the safety net for a drag that went wrong, rather than trying
to drag it back.

### The original file

Saving overwrites the resource. The first time a given `.scn` is written, its
untouched bytes are copied to an `_originals` folder beside the resource
folder, named after the entry, e.g.
`_originals/resources__model__character__male_bip.scn`. That copy is made once
and never overwritten afterwards, so it is always the state before your very
first edit. The status line tells you where it went.

To roll back, close the viewer and put that file back over the resource.

This matters more than it looks in container mode: `writeResourceData` copies
the new content into every blob sharing the entry's prefix, so an overwrite
touches several files at once and cannot be undone from the container.

---

## 5. Sequence viewer: `.seq` and single `.scn`

Same window, side panel, tab **Editor**.

For a **`.seq`**, every node field is editable. Change a value and it is patched
into the file and the effect restarts, so you see the result immediately. There
is also a texture list where you can swap one texture for another.

For a **`.scn`**, the panel has two halves:

* **Playback** (top): which clip, `from`/`to` in ms, speed, loop. This is saved
  in a `<name>.playback.json` beside the file, because the `.scn` format has
  nowhere to store it.
* **Nodes**: one collapsible per node, with its own clip selector and its
  transform matrix. `posX`, `posY`, `posZ` are the translation; the rest is
  rotation and scale. Editing writes to the `.scn` and reloads without losing
  your place in the animation.
* **Pose**: `initT`, `initR`, `initS` per bone for the selected clip.

---

## 6. Limits worth knowing

**Keys can be edited, not created.** The codec patches values where they already
are. It cannot insert keys, delete them, move them in time, or change a clip's
duration, because any of those changes the file size.

**Rotation only.** Posing writes rotation. Bending a joint is rotation; moving a
bone somewhere else pulls the mesh apart.

**`male_bip.scn` is shared.** All 721 clips and every character use it. A change
to a clip changes it for everybody, and the file is 32 MB, so each save is a
32 MB write.

**Editing happens on a temp copy.** ItemManager extracts the `.scn` to a temp
folder and deletes it when the window closes. That is why Save has to push the
bytes back into the resource, and why closing without saving loses everything.

---

## 7. If something looks wrong

**Bones scattered far from the model.** Fixed. A bone with no track for the
current clip used to fall back to its absolute matrix used as if it were a local
one, so it got multiplied by the parent twice. If you see it again on a
different model, that is the same bug in a different code path.

**A limb fans out into spikes.** Skin weights pointing somewhere unexpected.
Not the same problem as the one above, and not currently fixed: 87 piece/clip
combinations still do this out of 721 clips.

**A drag does nothing.** Either the range holds no key (read the status line) or
the bone you grabbed is a root with no parent to rotate.

## Using only part of a loaded animation

A Mixamo download is usually a run-up, the motion you want, and a settle. The
`use` and `to` boxes, in seconds, cut it down to the part worth keeping; leave
`to` empty for the end. The label next to them says how long the source is.

Changing them re-applies straight away - the file stays in memory, so there is
nothing to pick again. The same is true of `axis`, `how`, `time` and `mirror`.

Trimming changes which seconds of the source get read, not how many keys the S4
clip has: the clip keeps its own ticks either way.

## Making a clip play slower or faster in game

The speed slider is preview only. To change what the game plays, set the slider
to the speed you want and press `bake speed`: the key times are divided by it
and written into the clip on Save.

Keys cannot be added or removed, so speeding a clip up moves its keys closer
together. Where two would land on the same tick they are nudged one apart
rather than collapsing into one, and the message says how many.
