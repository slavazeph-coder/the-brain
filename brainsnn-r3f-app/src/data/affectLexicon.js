/**
 * Layer 29 — Affect Lexicon
 *
 * 12 discrete affects across 4 clusters (threat, reward, social, cognitive),
 * each positioned on Russell's circumplex (valence × arousal) with a display
 * color, a neurotransmitter analogue, an additive region-contribution vector,
 * and a trigger regex bank.
 *
 * Design: the decoder isn't a classifier — it's a fingerprint extractor.
 * Triggers are deliberately broad so the same passage can light up multiple
 * affects (that's the point: "same neural button, different finger").
 */

export const AFFECT_CLUSTERS = {
  threat: { label: 'Threat', color: '#ff4066' },
  reward: { label: 'Reward', color: '#ffd54a' },
  social: { label: 'Social', color: '#ff9ab8' },
  cognitive: { label: 'Cognitive', color: '#4db8ff' }
};

/**
 * Each entry:
 *   id          — canonical key
 *   label       — display name
 *   cluster     — one of AFFECT_CLUSTERS keys
 *   valence     — −1 (aversive) .. +1 (appetitive)
 *   arousal     —  0 (calm)     .. +1 (activated)
 *   color       — hex used for region glow override in 3D
 *   nt          — neurotransmitter analogue (narrative tag)
 *   regions     — additive nudge per brain region (−1..+1)
 *   triggers    — regex bank, matched with `.test(text)` and `.match(text)`
 */
export const AFFECT_LEXICON = {
  fear: {
    id: 'fear',
    label: 'Fear',
    cluster: 'threat',
    valence: -0.75,
    arousal: 0.85,
    color: '#ff4066',
    nt: 'cortisol',
    regions: { AMY: 0.35, THL: 0.2, HPC: 0.15, PFC: -0.1 },
    triggers: [
      /\b(threat|threaten(?:ed|ing)?|danger(?:ous)?|terrify(?:ing)?|terror|panic)/i,
      /\b(collapse|catastroph(?:e|ic)|disaster|apocalyp|doom(?:ed)?)/i,
      /\b(die|death|kill(?:ed|ing)?|destroy(?:ed|ing)?|annihilat)/i,
      /\b(warn(?:ing)?|alarm(?:ing)?|crisis|emergency|imminent)/i,
      /\b(scared|afraid|frightened|horrified|dread(?:ing)?)/i,
      /\b(unsafe|at risk|under attack|hunted|targeted)/i
    ]
  },
  anger: {
    id: 'anger',
    label: 'Anger',
    cluster: 'threat',
    valence: -0.6,
    arousal: 0.8,
    color: '#ff6040',
    nt: 'norepinephrine',
    regions: { AMY: 0.28, BG: 0.22, PFC: -0.15, CTX: -0.05 },
    triggers: [
      /\b(angry|angrier|furious|rage|raging|enraged)/i,
      /\b(outrage(?:d|ous)?|scandal(?:ous)?|disgrace(?:ful)?)/i,
      /\b(betray(?:ed|al)?|backstab|stab(?:bed)? in the back)/i,
      /\b(unfair|injustice|unjust|corrupt(?:ed|ion)?)/i,
      /\b(hate|hated|hating|loathe|despise|detest)/i,
      /\b(how dare|unacceptable|intolerable|fed up|sick of)/i,
      /\b(fight back|retaliat|vengeance|revenge)/i
    ]
  },
  disgust: {
    id: 'disgust',
    label: 'Disgust',
    cluster: 'threat',
    valence: -0.55,
    arousal: 0.5,
    color: '#8a5a40',
    nt: 'serotonin↓',
    regions: { AMY: 0.22, CTX: 0.15, BG: -0.05 },
    triggers: [
      /\b(disgust(?:ed|ing)?|gross|revolt(?:ing|ed)?|repuls(?:ive|ed))/i,
      /\b(nause(?:a|ating|ous)|sicken(?:ing|ed)?|vile|foul)/i,
      /\b(filthy|rotten|decay(?:ed|ing)?|putrid|rancid)/i,
      /\b(contaminat|infest|parasit|infect(?:ed|ion)?)/i,
      /\b(moral decay|degenerat|depraved|perverse)/i,
      /\b(can't stand|unbearable to watch|makes me sick)/i
    ]
  },
  joy: {
    id: 'joy',
    label: 'Joy',
    cluster: 'reward',
    valence: 0.85,
    arousal: 0.7,
    color: '#ffd54a',
    nt: 'dopamine',
    regions: { BG: 0.3, THL: 0.15, PFC: 0.1, AMY: 0.05 },
    triggers: [
      /\b(joy(?:ful|ous)?|joyous|delight(?:ed|ful)?|elated)/i,
      /\b(happy|happier|happiness|thrilled|ecstatic)/i,
      /\b(celebrat(?:e|ing|ion)|cheer(?:ing|ful)?|rejoic)/i,
      /\b(love(?:d|ly)?|adore|amazing|wonderful|fantastic)/i,
      /\b(fun|playful|laugh(?:ing|ter)?|giggl|smile|smiling)/i,
      /\b(victor(?:y|ious)|triumph(?:ant|ed)?|winning|win!)/i,
      /\b(yes!|woohoo|hooray|let's go|incredible)/i
    ]
  },
  awe: {
    id: 'awe',
    label: 'Awe',
    cluster: 'reward',
    valence: 0.65,
    arousal: 0.55,
    color: '#a78bfa',
    nt: 'oxytocin+dopamine',
    regions: { CTX: 0.28, AMY: 0.18, THL: 0.12, PFC: 0.05 },
    triggers: [
      /\b(awe(?:some|d|inspiring)?|breathtaking|magnificent)/i,
      /\b(sublime|transcend(?:ent|ing)?|ethereal|otherworldly)/i,
      /\b(infinit(?:e|y)|cosmic|universe|galactic|eternal)/i,
      /\b(sacred|divine|holy|spiritual|profound)/i,
      /\b(majestic|grand|vast|immense|overwhelming beauty)/i,
      /\b(stunned|speechless|lost for words|humbled by)/i,
      /\b(mystery of|wonder(?:s|ful|ing)? at|marvel(?:ous|ing)?)/i
    ]
  },
  pride: {
    id: 'pride',
    label: 'Pride',
    cluster: 'reward',
    valence: 0.55,
    arousal: 0.55,
    color: '#e89f3a',
    nt: 'dopamine',
    regions: { PFC: 0.22, BG: 0.15, CTX: 0.1 },
    triggers: [
      /\b(proud|pride(?:ful)?|accomplish(?:ed|ment)?)/i,
      /\b(achievement|achieved|earned|deserve(?:d|s)?)/i,
      /\b(excellence|excellent|outstanding|exemplary)/i,
      /\b(mastery|mastered|expert(?:ise)?|skill(?:ed|ful)?)/i,
      /\b(succeed(?:ed|ing)?|success(?:ful)?|accomplished)/i,
      /\b(champion|best in|top of|leading the)/i,
      /\b(recogni[zs](?:ed|tion)|awarded|honor(?:ed)?)/i
    ]
  },
  belonging: {
    id: 'belonging',
    label: 'Belonging',
    cluster: 'social',
    valence: 0.7,
    arousal: 0.35,
    color: '#ff9ab8',
    nt: 'oxytocin',
    regions: { AMY: 0.15, HPC: 0.2, PFC: 0.1, CTX: 0.08 },
    triggers: [
      /\b(we|our|us|ourselves)\b/i,
      /\b(together|united|unity|shared|sharing)/i,
      /\b(family|families|brother(?:s|hood)?|sister(?:s|hood)?)/i,
      /\b(community|communities|tribe|village|kin)/i,
      /\b(belong(?:ing)?|home|homeland|at home with)/i,
      /\b(support(?:ed|ing)?|held|embraced|welcomed)/i,
      /\b(friend(?:s|ship)?|neighbor(?:s|hood)?|ally|allies)/i
    ]
  },
  nostalgia: {
    id: 'nostalgia',
    label: 'Nostalgia',
    cluster: 'social',
    valence: 0.3,
    arousal: 0.3,
    color: '#b87dc6',
    nt: 'oxytocin+mild dopamine',
    regions: { HPC: 0.35, CTX: 0.15, AMY: 0.08, THL: 0.05 },
    triggers: [
      /\b(nostalgi(?:a|c)|remember when|back in the day)/i,
      /\b(childhood|growing up|younger days|when I was)/i,
      /\b(memories|memory of|reminds me|reminded of)/i,
      /\b(used to|once upon|the old|bygone|days of old)/i,
      /\b(good old|golden (?:age|era|days)|simpler times)/i,
      /\b(miss(?:ed|ing)? (?:the|those)|longing for|yearn)/i,
      /\b(legacy|heritage|tradition(?:s|al)?|ancestral)/i
    ]
  },
  shame: {
    id: 'shame',
    label: 'Shame',
    cluster: 'social',
    valence: -0.65,
    arousal: 0.4,
    color: '#6a4a80',
    nt: 'cortisol',
    regions: { AMY: 0.25, PFC: -0.2, BG: -0.1, HPC: 0.05 },
    triggers: [
      /\b(shame(?:d|ful)?|ashamed|embarrass(?:ed|ing|ment)?)/i,
      /\b(humiliat(?:ed|ing|ion)?|mortif(?:ied|ying))/i,
      /\b(guilty|guilt(?:-ridden)?|remorse(?:ful)?)/i,
      /\b(unworthy|not good enough|failure|failed me)/i,
      /\b(should have|shouldn't have|I'm sorry|my fault)/i,
      /\b(disappoint(?:ed|ing|ment)?|let (?:down|you down))/i,
      /\b(hide|hiding|cover(?:ed)? up|can't face)/i
    ]
  },
  curiosity: {
    id: 'curiosity',
    label: 'Curiosity',
    cluster: 'cognitive',
    valence: 0.45,
    arousal: 0.5,
    color: '#4db8ff',
    nt: 'dopamine',
    regions: { CTX: 0.22, PFC: 0.18, THL: 0.1 },
    triggers: [
      /\b(curious(?:ly)?|curiosity|wonder(?:ing)?|wondered)/i,
      /\b(what if|how (?:does|do|would)|why (?:does|do|would))/i,
      /\b(explor(?:e|ing|ation)|investigat(?:e|ing|ion)?)/i,
      /\b(discover(?:ed|ing|y)?|uncover(?:ed|ing)?|reveal(?:ed)?)/i,
      /\b(question(?:s|ing)?|inquir(?:e|ing|y)|ponder)/i,
      /\b(interesting|fascinating|intriguing|compelling)/i,
      /\b(learn(?:ing)?|study(?:ing)?|understand(?:ing)?)/i
    ]
  },
  certainty: {
    id: 'certainty',
    label: 'Certainty',
    cluster: 'cognitive',
    valence: 0.25,
    arousal: 0.3,
    color: '#7dd87f',
    nt: 'serotonin',
    regions: { PFC: 0.2, BG: 0.1, CTX: 0.05 },
    triggers: [
      /\b(certain(?:ly)?|certainty|definitely|absolutely)/i,
      /\b(obvious(?:ly)?|clear(?:ly)?|plain(?:ly)?|no doubt)/i,
      /\b(proven|proof|fact|facts|undeniabl(?:e|y))/i,
      /\b(guarantee(?:d)?|100%|one hundred percent|surefire)/i,
      /\b(everyone knows|nobody disputes|it is known)/i,
      /\b(always|never fails|inevitabl(?:e|y)|bound to)/i,
      /\b(confident|confidence|assured|assurance)/i
    ]
  },
  confusion: {
    id: 'confusion',
    label: 'Confusion',
    cluster: 'cognitive',
    valence: -0.2,
    arousal: 0.45,
    color: '#8a8f99',
    nt: 'acetylcholine',
    regions: { PFC: -0.15, CTX: 0.1, THL: 0.18, AMY: 0.05 },
    triggers: [
      /\b(confus(?:ed|ing|ion)?|bewilder(?:ed|ing)?|perplex)/i,
      /\b(unclear|murky|muddled|fuzzy|hazy)/i,
      /\b(don't (?:know|understand|get it)|can't tell)/i,
      /\b(doesn't (?:make sense|add up|compute|fit))/i,
      /\b(contradict(?:s|ion|ory)?|inconsisten(?:t|cy))/i,
      /\b(lost|disoriented|out of my depth|head spinning)/i,
      /\b(ambiguous|vague|uncertain(?:ty)?|not sure)/i
    ]
  }
};

export const AFFECT_IDS = Object.keys(AFFECT_LEXICON);

export function affectsByCluster(cluster) {
  return AFFECT_IDS.filter((id) => AFFECT_LEXICON[id].cluster === cluster);
}
