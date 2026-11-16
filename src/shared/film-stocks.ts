// 胶卷型号下拉菜单：按品牌分组。要增加型号，在对应 films 数组里新增一行。
// 字符串同时用于菜单、项目保存和导出标题；保留常见包装名称，方便记录旧胶卷。
// 型号参考：kodakprofessional.com、fujifilm.com、cinestillfilm.com、ilfordphoto.com。
export const filmStockGroups = [
  {
    brand: '柯达 Kodak',
    films: [
      'Kodak Gold 200',
      'Kodak UltraMax 400',
      'Kodak Portra 160',
      'Kodak Portra 400',
      'Kodak Portra 800',
      'Kodak Ektar 100',
      'Kodak Ektachrome E100',
      'Kodak Tri-X 400',
      'Kodak T-Max 100',
      'Kodak T-Max 400'
    ]
  },
  {
    brand: '富士 Fujifilm',
    films: [
      'Fujifilm 200',
      'Fujifilm 400',
      'Fujifilm Velvia 50',
      'Fujifilm Velvia 100',
      'Fujifilm Provia 100F',
      'Fujifilm Neopan Acros II 100'
    ]
  },
  {
    brand: 'CineStill',
    films: [
      'CineStill 50D',
      'CineStill 400D',
      'CineStill 800T',
      'CineStill BwXX'
    ]
  },
  {
    brand: '伊尔福 Ilford',
    films: [
      'Ilford HP5 Plus 400',
      'Ilford FP4 Plus 125',
      'Ilford Pan F Plus 50',
      'Ilford Delta 100',
      'Ilford Delta 400',
      'Ilford Delta 3200',
      'Ilford XP2 Super 400'
    ]
  }
] as const

const knownFilms = new Set<string>(filmStockGroups.flatMap(group => [...group.films]))
export const isPresetFilm = (film: string) => knownFilms.has(film)
export const OTHER_FILM = '__other_film__'
