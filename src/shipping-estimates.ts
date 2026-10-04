export const vietnamProvinces = [
  ['01', 'Thành phố Hà Nội'], ['04', 'Tỉnh Cao Bằng'], ['08', 'Tỉnh Tuyên Quang'], ['11', 'Tỉnh Điện Biên'],
  ['12', 'Tỉnh Lai Châu'], ['14', 'Tỉnh Sơn La'], ['15', 'Tỉnh Lào Cai'], ['19', 'Tỉnh Thái Nguyên'],
  ['20', 'Tỉnh Lạng Sơn'], ['22', 'Tỉnh Quảng Ninh'], ['24', 'Tỉnh Bắc Ninh'], ['25', 'Tỉnh Phú Thọ'],
  ['31', 'Thành phố Hải Phòng'], ['33', 'Tỉnh Hưng Yên'], ['37', 'Tỉnh Ninh Bình'], ['38', 'Tỉnh Thanh Hóa'],
  ['40', 'Tỉnh Nghệ An'], ['42', 'Tỉnh Hà Tĩnh'], ['44', 'Tỉnh Quảng Trị'], ['46', 'Thành phố Huế'],
  ['48', 'Thành phố Đà Nẵng'], ['51', 'Tỉnh Quảng Ngãi'], ['52', 'Tỉnh Gia Lai'], ['56', 'Tỉnh Khánh Hòa'],
  ['66', 'Tỉnh Đắk Lắk'], ['68', 'Tỉnh Lâm Đồng'], ['75', 'Tỉnh Đồng Nai'], ['79', 'Thành phố Hồ Chí Minh'],
  ['80', 'Tỉnh Tây Ninh'], ['82', 'Tỉnh Đồng Tháp'], ['86', 'Tỉnh Vĩnh Long'], ['91', 'Tỉnh An Giang'],
  ['92', 'Thành phố Cần Thơ'], ['96', 'Tỉnh Cà Mau'],
] as const;

export type ProvinceCode = typeof vietnamProvinces[number][0];
export function provinceLabel(code: string): string | null {
  return vietnamProvinces.find(([value]) => value === code)?.[1] ?? null;
}

export type ShippingEstimate = { minVnd: number; maxVnd: number; ruleId: string | null; label: string; isFallback: boolean } | null;
export async function resolveShippingEstimate(query: (sql: string, values: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>, provenance: string, code: string): Promise<ShippingEstimate> {
  const result = await query(`SELECT id,display_name AS label,estimate_min_vnd AS "minVnd",estimate_max_vnd AS "maxVnd",is_fallback AS "isFallback"
    FROM shipping_estimate_rules WHERE provenance=$1 AND is_active AND ((NOT is_fallback AND province_code=$2) OR is_fallback)
    ORDER BY is_fallback ASC LIMIT 1`, [provenance, code]);
  const row = result.rows[0];
  return row ? { minVnd: Number(row.minVnd), maxVnd: Number(row.maxVnd), ruleId: String(row.id), label: String(row.label), isFallback: Boolean(row.isFallback) } : null;
}
