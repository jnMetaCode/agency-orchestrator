/**
 * 风格库：一个风格 = 中文名 + 一段可复用的**提示词后缀**（摄影机/镜头/胶片/色调/光源，与 5 段式方法论同口径）。
 *
 * 用法：工作流输入写 `source: styles`，Studio 渲染成按分类分组的下拉，用户选中文名；
 * 运行前引擎把该输入的值展开成「中文名：提示词后缀」（见 index.ts expandStyleInputs），
 * 所以 CLI 传 id / 中文名 / 自己写的一段描述，行为一致——认识的展开，不认识的原样透传。
 *
 * sample 是示例图（相对 website/public 的路径）；**没生成之前留空，不放占位图冒充**。
 * 批量生成脚本与 scripts/gen-video-previews.mjs 同思路（用 type: image 出图，默认空跑）。
 */
export interface StylePreset {
  id: string;
  name: string;
  nameEn: string;
  category: 'live' | '2d' | '3d';
  /** 英文提示词后缀，模型直接消费 */
  prompt: string;
  /** 负面提示词（可选） */
  negative?: string;
  sample?: string;
}

export const STYLE_PRESETS: StylePreset[] = [
  { id: 'american-retro-hollywood', name: '美式复古好莱坞', nameEn: 'American retro Hollywood', category: 'live',
    prompt: '1970s Hollywood film look, shot on Panavision Panaflex with anamorphic C-series lenses, Kodak 5247 film stock, warm golden tungsten light with soft halation, gentle film grain, muted saturated colors, slight lens flare' },
  { id: 'neon-cyberpunk', name: '霓虹赛博电影', nameEn: 'Neon cyberpunk cinema', category: 'live',
    prompt: 'rain-soaked night city, neon signage in magenta and cyan, wet asphalt reflections, ARRI Alexa 65 with Zeiss Master Anamorphic lenses, high contrast teal-and-magenta grade, volumetric haze, practical neon as key light' },
  { id: 'japanese-youth-film', name: '日式青春胶片', nameEn: 'Japanese youth film', category: 'live',
    prompt: 'Japanese coming-of-age film look, Fujifilm Eterna 500T stock, soft overexposed daylight, airy pastel greens and cream whites, 35mm prime lens at wide aperture, shallow depth of field, quiet natural light through windows' },
  { id: 'chinese-urban-realism', name: '国产都市写实', nameEn: 'Chinese urban realism', category: 'live',
    prompt: 'contemporary Chinese city realism, handheld Sony Venice with Cooke S4 lenses, neutral low-saturation grade with cool shadows, fluorescent and LED practical lights, documentary framing, lived-in apartments and street food stalls' },
  { id: 'wuxia-realism', name: '武侠江湖写实摄影', nameEn: 'Wuxia realism', category: 'live',
    prompt: 'realistic wuxia cinematography, misty mountains and bamboo forests, ARRI Alexa Mini LF with vintage Canon K-35 lenses, desaturated earth tones with ink-wash blacks, backlit fog, natural overcast light, weathered linen and leather textures' },
  { id: 'korean-drama-softlight', name: '韩剧都市柔光', nameEn: 'Korean drama soft light', category: 'live',
    prompt: 'Korean drama look, soft diffused window light, clean skin tones, RED Komodo with Sigma Cine primes, pastel warm grade with lifted blacks, tidy interiors, glass and cafe reflections, gentle bokeh' },
  { id: 'atompunk-retro-scifi', name: '复古科幻原子朋克', nameEn: 'Atompunk retro sci-fi', category: 'live',
    prompt: '1950s atompunk retro-futurism, chrome domes and analog dials, Technicolor-inspired saturated primaries, Mitchell BNC camera look with Baltar lenses, hard studio key light, matte painting skies, immaculate mid-century surfaces' },
  { id: 'old-industrial', name: '老式工业影视', nameEn: 'Old industrial film', category: 'live',
    prompt: 'old industrial film look, foundries and steel mills, sodium-vapor orange against steel blue, ARRIFLEX 35 with Zeiss Super Speed lenses, heavy grain, smoke and sparks, sweat and grease on skin, rust and scratched metal' },
  { id: 'wilderness-cinema', name: '荒野电影', nameEn: 'Wilderness cinema', category: 'live',
    prompt: 'wide wilderness cinema, vast empty landscapes, natural golden-hour and blue-hour light only, ARRI Alexa 65 with Hasselblad Prime DNA lenses, dusty warm highlights and cold shadows, wind-blown grass, long lens compression on horizons' },
  { id: 'palace-intrigue', name: '宫斗权谋冷峻', nameEn: 'Palace intrigue', category: 'live',
    prompt: 'Chinese palace intrigue drama, cold desaturated grade with deep crimson and jade accents, candle and lantern practicals, Sony Venice 2 with Leitz Summilux-C lenses, symmetrical formal framing, embroidered silk textures, incense haze' },
  { id: 'nineties-realism', name: '90 年代写实电影', nameEn: '1990s realism', category: 'live',
    prompt: '1990s realist cinema, Kodak Vision 500T stock look, tungsten interiors with green fluorescent spill, handheld 16mm energy, muted browns and greys, CRT glow, worn denim and wool textures' },
  { id: 'japanese-bw-film', name: '日本黑白胶片', nameEn: 'Japanese black & white film', category: 'live',
    prompt: 'Japanese black-and-white film photography, Kodak Double-X stock, high-contrast silver tones with rich mid-greys, static tripod compositions, window light and paper screens, quiet domestic interiors, fine grain' },
  { id: 'chinese-warm-blue', name: '中式暖调蓝辉', nameEn: 'Chinese warm-and-blue', category: 'live',
    prompt: 'warm tungsten interiors against cool blue dusk exteriors, Chinese neo-noir grade, ARRI Alexa with Cooke Anamorphic/i lenses, lantern and shop-sign practicals, humid haze, reflective wet tiles' },
  { id: 'pixar-3d', name: '3D 动画电影', nameEn: '3D animated feature', category: '3d',
    prompt: 'Pixar-style 3D animated feature, subsurface-scattered skin, soft global illumination, expressive stylized proportions, physically based materials, cinematic depth of field, warm rim light, clean rendered look' },
  { id: 'anime-2d', name: '2D 手绘动画', nameEn: '2D hand-drawn anime', category: '2d',
    prompt: '2D hand-drawn anime, clean line art with cel shading, painted backgrounds with soft gradients, limited animation feel, Ghibli-like natural light and clouds, warm midday palette, subtle film grain' },
];

export const STYLE_MAP: Record<string, StylePreset> = Object.fromEntries(STYLE_PRESETS.map((s) => [s.id, s]));

/** 按 id / 中文名 / 英文名（忽略大小写与首尾空白）找风格；找不到返回 undefined */
export function findStyle(value: string): StylePreset | undefined {
  const v = value.trim().toLowerCase();
  if (!v) return undefined;
  return STYLE_PRESETS.find((s) => s.id === v || s.name.toLowerCase() === v || s.nameEn.toLowerCase() === v);
}

/** 展开成提示词里可直接用的一段：「中文名：英文后缀」。不认识的原样返回（用户自己写的描述） */
export function expandStyle(value: string): string {
  const s = findStyle(value);
  return s ? `${s.name}（${s.nameEn}）: ${s.prompt}` : value;
}
