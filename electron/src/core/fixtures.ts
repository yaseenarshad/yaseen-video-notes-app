// Test fixtures shared by the ported Swift unit tests (Tests/FollowAlongKitTests).

/**
 * A small piece of real YouTube auto-caption VTT (rolling format, word tags, 10 ms settle cues,
 * `&gt;&gt;` speaker changes, an untagged one-word line).
 */
export const rollingVTT = `WEBVTT
Kind: captions
Language: en

00:00:00.480 --> 00:00:03.350 align:start position:0%
<SP>
Last<00:00:00.880><c> night</c><00:00:01.280><c> in</c><00:00:01.520><c> Waco,</c><00:00:02.000><c> Texas,</c>

00:00:03.350 --> 00:00:03.360 align:start position:0%
Last night in Waco, Texas,
<SP>

00:00:03.360 --> 00:00:06.550 align:start position:0%
Last night in Waco, Texas,
it<00:00:04.160><c> is</c><00:00:04.560><c> street</c><00:00:05.120><c> legal.</c>

00:00:06.550 --> 00:00:06.560 align:start position:0%
it is street legal.
<SP>

00:00:11.920 --> 00:00:13.509 align:start position:0%
it is street legal.
&gt;&gt; What<00:00:12.080><c> would</c><00:00:12.160><c> it</c><00:00:12.320><c> cost</c><00:00:12.480><c> for</c>

00:00:13.509 --> 00:00:13.519 align:start position:0%
&gt;&gt; What would it cost for
<SP>

00:00:13.519 --> 00:00:13.830 align:start position:0%
&gt;&gt; What would it cost for
that?

00:00:13.830 --> 00:00:13.840 align:start position:0%
that?
<SP>

00:00:13.840 --> 00:00:15.000 align:start position:0%
that?
&gt;&gt; Yeah.

00:00:15.000 --> 00:00:15.010 align:start position:0%
&gt;&gt; Yeah.
<SP>

00:00:15.010 --> 00:00:16.000 align:start position:0%
&gt;&gt; Yeah.
&gt;&gt; Yeah.
`.replaceAll('<SP>', ' ')

export const sampleMD = `---
id: YAS-398
---
# Title

- channel: Chan
- url: https://www.youtube.com/watch?v=ID
- duration: 0:10:00
- views: 1
- uploaded: 20261017

---

[0:00](https://www.youtube.com/watch?v=ID&t=0s) First paragraph words.

[0:11](https://www.youtube.com/watch?v=ID&t=11s) — Second paragraph.

[1:02:03](https://www.youtube.com/watch?v=ID&t=3723s) — Third paragraph.
`
