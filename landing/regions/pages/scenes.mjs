// Landmark scenes for the regional pages.
//
// Each scene is a flat-silhouette drawing on a 1440×900 canvas, sliced to fill
// the hero. Colours come from CSS custom properties set per country in data.mjs,
// so the same geometry reads as Saharan dusk in Egypt and tropical night in
// Angola. Layers run back-to-front: sky, glow, far ridge, mid ridge, subject,
// foreground — which is what gives the parallax depth.

const sky = (id) => `
      <linearGradient id="sky-${id}" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="var(--sky-top)"/>
        <stop offset=".55" stop-color="var(--sky-mid)"/>
        <stop offset="1" stop-color="var(--sky-low)"/>
      </linearGradient>
      <radialGradient id="glow-${id}" cx="50%" cy="50%" r="50%">
        <stop offset="0" stop-color="var(--moon)" stop-opacity=".55"/>
        <stop offset=".35" stop-color="var(--moon)" stop-opacity=".16"/>
        <stop offset="1" stop-color="var(--moon)" stop-opacity="0"/>
      </radialGradient>
      <linearGradient id="subj-${id}" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="var(--accent-a)"/>
        <stop offset="1" stop-color="var(--accent-b)"/>
      </linearGradient>`;

/** Shared opening: sky wash, moon and its glow, starfield mount point. */
const open = (id, moonX = 260, moonY = 190, moonR = 26) => `
    <defs>${sky(id)}</defs>
    <rect width="1440" height="900" fill="url(#sky-${id})"/>
    <circle cx="${moonX}" cy="${moonY}" r="300" fill="url(#glow-${id})"/>
    <circle cx="${moonX}" cy="${moonY}" r="${moonR}" fill="var(--moon)" opacity=".9"/>
    <g class="stars" data-stars="${id}"></g>`;

const SCENES = {
  // Issyk-Kul under the Tian Shan — snow ridges above a still lake.
  lakeMountains: (id) => `${open(id, 240, 175)}
    <path d="M0 470 L150 405 L300 455 L450 380 L600 445 L760 370 L920 435 L1080 355 L1240 425 L1440 375 L1440 640 L0 640 Z" fill="var(--ridge-far)"/>
    <path d="M0 540 L200 486 L400 530 L620 476 L840 520 L1060 468 L1280 512 L1440 480 L1440 700 L0 700 Z" fill="var(--ridge-mid)"/>
    <path d="M450 380 L500 410 L470 415 L520 448 L380 448 L420 412 Z" fill="var(--accent-a)" opacity=".85"/>
    <path d="M920 435 L960 462 L935 466 L975 492 L865 492 L898 462 Z" fill="var(--accent-a)" opacity=".7"/>
    <rect y="640" width="1440" height="260" fill="url(#subj-${id})" opacity=".55"/>
    <g opacity=".33" fill="var(--moon)">
      <rect x="180" y="676" width="150" height="2" rx="1"/><rect x="240" y="716" width="230" height="2" rx="1"/>
      <rect x="620" y="700" width="300" height="2" rx="1"/><rect x="900" y="752" width="260" height="2" rx="1"/>
    </g>`,

  // Simien escarpment — stacked basalt tables dropping into haze.
  escarpment: (id) => `${open(id, 1180, 200)}
    <path d="M0 520 L180 470 L360 508 L540 452 L760 500 L980 448 L1200 496 L1440 450 L1440 660 L0 660 Z" fill="var(--ridge-far)"/>
    <path d="M0 596 L150 560 L150 620 L340 574 L340 636 L560 588 L560 650 L820 596 L820 656 L1080 604 L1080 664 L1440 612 L1440 900 L0 900 Z" fill="var(--ridge-mid)"/>
    <path d="M120 640 L300 640 L300 900 L120 900 Z M520 668 L700 668 L700 900 L520 900 Z M980 684 L1180 684 L1180 900 L980 900 Z" fill="url(#subj-${id})" opacity=".5"/>
    <path d="M0 792 L1440 748 L1440 900 L0 900 Z" fill="var(--sky-top)" opacity=".55"/>`,

  // Paro Taktsang — the monastery pinned to a sheer cliff.
  cliffMonastery: (id) => `${open(id, 1150, 180)}
    <path d="M0 500 L220 440 L440 496 L680 424 L920 488 L1180 428 L1440 484 L1440 660 L0 660 Z" fill="var(--ridge-far)"/>
    <path d="M300 900 L360 380 L500 300 L640 372 L700 900 Z" fill="var(--ridge-mid)"/>
    <path d="M980 900 L1020 470 L1120 420 L1220 466 L1260 900 Z" fill="var(--ridge-mid)" opacity=".8"/>
    <g fill="url(#subj-${id})">
      <rect x="416" y="452" width="120" height="76" rx="3"/>
      <path d="M406 452 L476 416 L546 452 Z"/>
      <rect x="452" y="404" width="48" height="46" rx="3"/>
      <path d="M444 404 L476 380 L508 404 Z"/>
      <rect x="540" y="486" width="64" height="48" rx="3"/>
      <path d="M532 486 L572 462 L612 486 Z"/>
    </g>
    <g fill="var(--moon)" opacity=".8">
      <rect x="436" y="474" width="11" height="16" rx="2"/><rect x="470" y="474" width="11" height="16" rx="2"/>
      <rect x="504" y="474" width="11" height="16" rx="2"/><rect x="558" y="502" width="10" height="14" rx="2"/>
    </g>
    <path d="M0 792 L1440 756 L1440 900 L0 900 Z" fill="var(--sky-top)" opacity=".5"/>`,

  // Salto Ángel — the world's tallest fall off a flat-topped tepui.
  waterfallTepui: (id) => `${open(id, 300, 170)}
    <path d="M0 540 L240 496 L520 536 L820 484 L1120 528 L1440 486 L1440 680 L0 680 Z" fill="var(--ridge-far)"/>
    <path d="M700 900 L700 300 L1180 268 L1180 900 Z" fill="var(--ridge-mid)"/>
    <path d="M700 300 L1180 268 L1180 316 L700 348 Z" fill="var(--accent-b)" opacity=".55"/>
    <path d="M880 316 Q894 520 872 700 Q902 720 926 700 Q908 520 924 314 Z" fill="url(#subj-${id})" opacity=".9"/>
    <ellipse cx="898" cy="712" rx="120" ry="26" fill="var(--moon)" opacity=".18"/>
    <path d="M0 700 L360 664 L760 704 L1440 660 L1440 900 L0 900 Z" fill="var(--ridge-mid)" opacity=".85"/>`,

  // Itaipú — the dam wall and its spillway, the reason power is cheap here.
  dam: (id) => `${open(id, 1160, 180)}
    <path d="M0 520 L280 480 L620 520 L980 476 L1440 516 L1440 660 L0 660 Z" fill="var(--ridge-far)"/>
    <rect x="0" y="600" width="1440" height="60" fill="var(--ridge-mid)"/>
    <path d="M120 600 L1320 600 L1260 830 L180 830 Z" fill="url(#subj-${id})" opacity=".85"/>
    <g fill="var(--sky-top)" opacity=".45">
      <rect x="300" y="620" width="52" height="200"/><rect x="470" y="620" width="52" height="200"/>
      <rect x="640" y="620" width="52" height="200"/><rect x="810" y="620" width="52" height="200"/>
      <rect x="980" y="620" width="52" height="200"/>
    </g>
    <g fill="var(--moon)" opacity=".22">
      <path d="M326 700 Q336 780 326 830 L352 830 Q342 780 352 700 Z"/>
      <path d="M666 700 Q676 780 666 830 L692 830 Q682 780 692 700 Z"/>
      <path d="M1006 700 Q1016 780 1006 830 L1032 830 Q1022 780 1032 700 Z"/>
    </g>
    <rect y="830" width="1440" height="70" fill="var(--sky-low)" opacity=".8"/>`,

  // The Sundarbans — tidal channels threading a mangrove delta.
  delta: (id) => `${open(id, 1120, 190)}
    <path d="M0 560 L300 528 L620 562 L960 522 L1440 558 L1440 660 L0 660 Z" fill="var(--ridge-far)"/>
    <rect y="620" width="1440" height="280" fill="url(#subj-${id})" opacity=".4"/>
    <g fill="var(--ridge-mid)">
      <path d="M0 640 Q220 672 420 648 Q620 624 900 660 Q1180 696 1440 654 L1440 700 L0 700 Z"/>
      <path d="M0 748 Q280 716 560 752 Q840 788 1440 740 L1440 800 L0 800 Z"/>
    </g>
    <g fill="var(--accent-b)" opacity=".85">
      <path d="M120 640 L134 596 L148 640 Z"/><path d="M180 640 L196 588 L212 640 Z"/>
      <path d="M300 648 L316 600 L332 648 Z"/><path d="M760 660 L776 612 L792 660 Z"/>
      <path d="M980 668 L996 620 L1012 668 Z"/><path d="M1200 660 L1216 610 L1232 660 Z"/>
    </g>
    <g opacity=".3" fill="var(--moon)">
      <rect x="260" y="836" width="280" height="2" rx="1"/><rect x="700" y="864" width="340" height="2" rx="1"/>
    </g>`,

  // Badshahi Mosque — three domes and four corner minarets.
  mosque: (id) => `${open(id, 300, 180)}
    <path d="M0 560 L320 520 L700 560 L1080 516 L1440 556 L1440 700 L0 700 Z" fill="var(--ridge-far)"/>
    <rect x="0" y="700" width="1440" height="200" fill="var(--ridge-mid)"/>
    <g fill="url(#subj-${id})">
      <rect x="440" y="560" width="560" height="140" rx="4"/>
      <path d="M640 560 Q720 432 800 560 Z"/>
      <path d="M500 578 Q556 486 612 578 Z"/>
      <path d="M828 578 Q884 486 940 578 Z"/>
      <rect x="392" y="428" width="34" height="272" rx="4"/>
      <rect x="1014" y="428" width="34" height="272" rx="4"/>
      <rect x="470" y="468" width="26" height="100" rx="4" opacity=".7"/>
      <rect x="944" y="468" width="26" height="100" rx="4" opacity=".7"/>
    </g>
    <g fill="var(--moon)" opacity=".85">
      <circle cx="409" cy="416" r="11"/><circle cx="1031" cy="416" r="11"/><circle cx="720" cy="424" r="9"/>
    </g>
    <g fill="var(--sky-top)" opacity=".5">
      <rect x="600" y="624" width="34" height="76" rx="17"/><rect x="700" y="616" width="40" height="84" rx="20"/>
      <rect x="806" y="624" width="34" height="76" rx="17"/>
    </g>`,

  // Giza — three pyramids and the Sphinx against a desert dusk.
  pyramids: (id) => `${open(id, 1140, 190)}
    <path d="M0 600 L360 566 L760 604 L1120 562 L1440 598 L1440 700 L0 700 Z" fill="var(--ridge-far)"/>
    <g fill="url(#subj-${id})">
      <path d="M300 700 L610 300 L920 700 Z"/>
      <path d="M840 700 L1080 396 L1320 700 Z" opacity=".9"/>
      <path d="M150 700 L300 508 L450 700 Z" opacity=".75"/>
    </g>
    <path d="M610 300 L920 700 L700 700 Z" fill="var(--sky-top)" opacity=".28"/>
    <path d="M1080 396 L1320 700 L1160 700 Z" fill="var(--sky-top)" opacity=".28"/>
    <g fill="var(--accent-b)">
      <path d="M470 700 L470 640 Q470 606 506 606 Q542 606 542 640 L560 640 L610 700 Z"/>
      <rect x="486" y="592" width="42" height="30" rx="8"/>
    </g>
    <rect y="700" width="1440" height="200" fill="var(--ridge-mid)"/>
    <path d="M0 742 Q360 716 720 748 Q1080 780 1440 744 L1440 900 L0 900 Z" fill="var(--sky-top)" opacity=".4"/>`,

  // The Malwiya of Samarra — a spiralling ramp climbing a cone.
  spiralMinaret: (id) => `${open(id, 320, 180)}
    <path d="M0 596 L340 560 L740 598 L1100 556 L1440 594 L1440 700 L0 700 Z" fill="var(--ridge-far)"/>
    <rect y="700" width="1440" height="200" fill="var(--ridge-mid)"/>
    <g fill="url(#subj-${id})">
      <path d="M600 700 L660 312 L780 312 L840 700 Z"/>
      <rect x="666" y="266" width="108" height="52" rx="4"/>
    </g>
    <g fill="var(--sky-top)" opacity=".35">
      <path d="M612 660 L828 660 L822 626 L618 626 Z"/>
      <path d="M624 584 L816 584 L810 550 L630 550 Z"/>
      <path d="M636 508 L804 508 L798 474 L642 474 Z"/>
      <path d="M648 432 L792 432 L786 398 L654 398 Z"/>
      <path d="M658 360 L782 360 L777 330 L663 330 Z"/>
    </g>
    <circle cx="720" cy="252" r="10" fill="var(--moon)" opacity=".85"/>
    <path d="M0 764 Q400 736 800 770 Q1120 796 1440 762 L1440 900 L0 900 Z" fill="var(--sky-top)" opacity=".42"/>`,

  // Kalandula — a broad curtain fall in the wet season.
  fallsWide: (id) => `${open(id, 1140, 180)}
    <path d="M0 520 L300 486 L640 522 L980 480 L1440 518 L1440 640 L0 640 Z" fill="var(--ridge-far)"/>
    <path d="M180 900 L180 470 Q720 424 1260 470 L1260 900 Z" fill="var(--ridge-mid)"/>
    <g fill="url(#subj-${id})" opacity=".9">
      <path d="M300 486 Q312 640 296 742 L360 742 Q346 640 360 484 Z"/>
      <path d="M420 478 Q434 646 416 752 L492 752 Q474 646 490 476 Z"/>
      <path d="M560 472 Q576 652 556 758 L648 758 Q628 652 646 470 Z"/>
      <path d="M720 470 Q736 654 716 760 L808 760 Q788 654 806 468 Z"/>
      <path d="M880 474 Q894 650 876 754 L956 754 Q938 650 954 472 Z"/>
      <path d="M1010 480 Q1024 644 1008 746 L1076 746 Q1060 644 1074 478 Z"/>
    </g>
    <ellipse cx="700" cy="768" rx="440" ry="40" fill="var(--moon)" opacity=".16"/>
    <rect y="784" width="1440" height="116" fill="var(--sky-low)" opacity=".7"/>`,

  // Havana — the Capitolio dome behind the Malecón seawall.
  havana: (id) => `${open(id, 1160, 170)}
    <path d="M0 596 L340 566 L700 600 L1080 560 L1440 596 L1440 680 L0 680 Z" fill="var(--ridge-far)"/>
    <g fill="url(#subj-${id})">
      <rect x="300" y="600" width="840" height="100" rx="3"/>
      <rect x="620" y="512" width="200" height="92" rx="3"/>
      <path d="M640 512 Q720 356 800 512 Z"/>
      <rect x="706" y="316" width="28" height="46" rx="4"/>
      <rect x="360" y="556" width="150" height="48" rx="3" opacity=".85"/>
      <rect x="930" y="556" width="150" height="48" rx="3" opacity=".85"/>
    </g>
    <g fill="var(--moon)" opacity=".75">
      <circle cx="720" cy="304" r="9"/>
      <rect x="392" y="620" width="14" height="26" rx="2"/><rect x="440" y="620" width="14" height="26" rx="2"/>
      <rect x="986" y="620" width="14" height="26" rx="2"/><rect x="1034" y="620" width="14" height="26" rx="2"/>
    </g>
    <rect y="700" width="1440" height="34" fill="var(--ridge-mid)"/>
    <rect y="734" width="1440" height="166" fill="var(--sky-low)" opacity=".8"/>
    <g opacity=".3" fill="var(--moon)">
      <rect x="200" y="792" width="220" height="2" rx="1"/><rect x="820" y="826" width="300" height="2" rx="1"/>
    </g>`,

  // Leptis Magna — a Roman colonnade left standing on the Libyan coast.
  ruins: (id) => `${open(id, 300, 176)}
    <path d="M0 604 L360 574 L740 606 L1100 568 L1440 602 L1440 700 L0 700 Z" fill="var(--ridge-far)"/>
    <rect y="700" width="1440" height="200" fill="var(--ridge-mid)"/>
    <g fill="url(#subj-${id})">
      <rect x="240" y="640" width="960" height="20" rx="3"/>
      <rect x="270" y="400" width="42" height="240" rx="4"/>
      <rect x="392" y="400" width="42" height="240" rx="4"/>
      <rect x="514" y="400" width="42" height="240" rx="4"/>
      <rect x="636" y="400" width="42" height="240" rx="4" opacity=".85"/>
      <rect x="758" y="424" width="42" height="216" rx="4" opacity=".7"/>
      <rect x="880" y="400" width="42" height="240" rx="4" opacity=".85"/>
      <rect x="1002" y="452" width="42" height="188" rx="4" opacity=".6"/>
      <rect x="1124" y="400" width="42" height="240" rx="4"/>
      <rect x="240" y="364" width="960" height="30" rx="3"/>
    </g>
    <path d="M0 780 Q380 754 760 786 Q1100 812 1440 780 L1440 900 L0 900 Z" fill="var(--sky-top)" opacity=".4"/>`,

  // Meroë — the steep, narrow Nubian pyramids of the Kushite kings.
  meroe: (id) => `${open(id, 1160, 186)}
    <path d="M0 604 L340 572 L720 606 L1100 566 L1440 602 L1440 690 L0 690 Z" fill="var(--ridge-far)"/>
    <g fill="url(#subj-${id})">
      <path d="M180 690 L268 388 L356 690 Z"/>
      <path d="M340 690 L420 436 L500 690 Z" opacity=".9"/>
      <path d="M520 690 L616 350 L712 690 Z"/>
      <path d="M700 690 L772 452 L844 690 Z" opacity=".85"/>
      <path d="M860 690 L948 396 L1036 690 Z" opacity=".95"/>
      <path d="M1020 690 L1092 462 L1164 690 Z" opacity=".8"/>
    </g>
    <g fill="var(--sky-top)" opacity=".3">
      <path d="M268 388 L356 690 L268 690 Z"/><path d="M616 350 L712 690 L616 690 Z"/><path d="M948 396 L1036 690 L948 690 Z"/>
    </g>
    <rect y="690" width="1440" height="210" fill="var(--ridge-mid)"/>
    <path d="M0 748 Q360 722 720 754 Q1080 786 1440 750 L1440 900 L0 900 Z" fill="var(--sky-top)" opacity=".42"/>`,

  // Persepolis — the Apadana columns and the Gate of All Nations.
  persepolis: (id) => `${open(id, 300, 178)}
    <path d="M0 596 L360 566 L740 600 L1100 560 L1440 596 L1440 700 L0 700 Z" fill="var(--ridge-far)"/>
    <rect y="700" width="1440" height="200" fill="var(--ridge-mid)"/>
    <g fill="url(#subj-${id})">
      <rect x="200" y="656" width="1040" height="44" rx="3"/>
      <rect x="262" y="356" width="38" height="300" rx="4"/>
      <rect x="392" y="356" width="38" height="300" rx="4"/>
      <rect x="522" y="356" width="38" height="300" rx="4" opacity=".85"/>
      <rect x="880" y="356" width="38" height="300" rx="4" opacity=".85"/>
      <rect x="1010" y="356" width="38" height="300" rx="4"/>
      <rect x="1140" y="356" width="38" height="300" rx="4"/>
      <rect x="640" y="440" width="160" height="216" rx="3"/>
      <rect x="618" y="404" width="204" height="40" rx="3"/>
    </g>
    <g fill="var(--moon)" opacity=".55">
      <rect x="252" y="336" width="58" height="22" rx="4"/><rect x="382" y="336" width="58" height="22" rx="4"/>
      <rect x="1000" y="336" width="58" height="22" rx="4"/><rect x="1130" y="336" width="58" height="22" rx="4"/>
    </g>
    <path d="M0 776 Q380 750 760 782 Q1100 808 1440 776 L1440 900 L0 900 Z" fill="var(--sky-top)" opacity=".4"/>`,
};

export function scene(name, id) {
  const fn = SCENES[name] || SCENES.lakeMountains;
  return `<svg class="scene" viewBox="0 0 1440 900" preserveAspectRatio="xMidYMid slice" aria-hidden="true">${fn(id)}
  </svg>`;
}

export const SCENE_NAMES = Object.keys(SCENES);
