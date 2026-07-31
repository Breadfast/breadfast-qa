/** Egyptian NID generator — port of UserDataFactory.generateRandomEgyptianNationalID (Luhn check digit). */
function luhn(number) {
  let sum = 0, alt = false;
  for (let i = number.length - 1; i >= 0; i--) {
    let n = +number[i];
    if (alt) { n *= 2; if (n > 9) n -= 9; }
    sum += n; alt = !alt;
  }
  return (10 - (sum % 10)) % 10;
}
function genNid(seed) {
  const century = 2;
  const y = 80 + (seed % 15), mo = 1 + (seed % 12), d = 1 + (seed % 27);
  const birth = String(y).padStart(2, '0') + String(mo).padStart(2, '0') + String(d).padStart(2, '0');
  const gov = String(1 + (seed % 29)).padStart(2, '0');
  const serial = String(1000 + ((seed * 137) % 9000)).padStart(4, '0');
  const payload = '' + century + birth + gov + serial;
  return payload + luhn(payload);
}
module.exports = { genNid, luhn };
if (require.main === module) {
  console.log('checking the one I guessed: 2980715120153 -> valid check digit is ' + luhn('2980715120153') + ' (I used 4)');
  for (let s = 1; s <= 6; s++) { const n = genNid(s * 7); console.log('  ' + n + '  len=' + n.length + '  luhn-ok=' + (luhn(n.slice(0, 13)) === +n[13])); }
}
