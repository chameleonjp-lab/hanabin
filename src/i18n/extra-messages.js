const keys=['SELECTION','RANGE','NEXT WAVES'];
const rows={ja:['選択','範囲','次の波'],en:['SELECTION','RANGE','NEXT WAVES'],es:['SELECCIÓN','ALCANCE','PRÓXIMAS OLAS'],'pt-BR':['SELEÇÃO','ALCANCE','PRÓXIMAS ONDAS'],'zh-Hans':['选择','范围','下一波'],fr:['SÉLECTION','PORTÉE','PROCHAINES VAGUES'],de:['AUSWAHL','REICHWEITE','NÄCHSTE WELLEN'],ko:['선택','범위','다음 웨이브'],ru:['ВЫБОР','РАДИУС','СЛЕДУЮЩИЕ ВОЛНЫ'],it:['SELEZIONE','RAGGIO','PROSSIME ONDATE'],'zh-Hant':['選擇','範圍','下一波'],id:['PILIHAN','JANGKAUAN','GELOMBANG BERIKUTNYA'],tr:['SEÇİM','MENZİL','SONRAKİ DALGALAR'],vi:['ĐÃ CHỌN','PHẠM VI','ĐỢT TIẾP THEO'],th:['ที่เลือก','ระยะ','ระลอกถัดไป']};
const messages = Object.fromEntries(Object.entries(rows).map(([id,values])=>[id,Object.fromEntries(keys.map((key,index)=>[key,values[index]]))]));

const volume = {ja:'音量',en:'Volume',es:'Volumen','pt-BR':'Volume','zh-Hans':'音量',fr:'Volume',de:'Lautstärke',ko:'음량',ru:'Громкость',it:'Volume','zh-Hant':'音量',id:'Volume',tr:'Ses düzeyi',vi:'Âm lượng',th:'ระดับเสียง'};
const go = {ja:'スタート',en:'GO',es:'¡YA!','pt-BR':'VAI!','zh-Hans':'开始',fr:'PARTEZ !',de:'LOS!',ko:'시작',ru:'СТАРТ',it:'VIA!','zh-Hant':'開始',id:'MULAI',tr:'BAŞLA',vi:'BẮT ĐẦU',th:'เริ่ม'};
for (const id of Object.keys(messages)) Object.assign(messages[id],{'音量':volume[id],GO:go[id]});
export default messages;
