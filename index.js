const axios = require('axios');
const cheerio = require('cheerio');
const isNumber = require('is-number');
const CronJob = require('cron').CronJob;
var express = require('express');
var app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(express.static(__dirname + '/views'));
const PouchDB = require('pouchdb');
PouchDB.plugin(require('pouchdb-find'));
PouchDB.plugin(require('pouchdb-upsert'));
PouchDB.plugin(require('pouchdb-quick-search-korean'));

var lists = new PouchDB('db/Lists');
var striptags = require('striptags');


app.use(function (req, res, next) {
    //console.log('Time:', Date.now());
    //    console.log('Request Type:', req.method);
    next();
});

app.get('/', function (req, res) {
    res.sendFile(__dirname + '/views/index.html');
});

app.post('/getAll', async function (req, res) {
    //console.log('req.body:', req.body);
    let start = req.body.start; //페이징번호
    let length = req.body.length; //몇개씩
    let draw = req.body.draw;
    let search_value = req.body["search[value]"] || null;
    let _isBreak = false;
    let docs = null;
    if (!isNumber(length) || !isNumber(start)) {
        _isBreak = true;
    }
    if (_isBreak) {
        console.log("[error] value");
        res.send({
            data: {}
        });
        return;
    }

    let offset = start;
    let rows_per_page = length;
    let page = (offset / rows_per_page);// + 1; // == 1
    let skip = page * rows_per_page; // == 10 for the first page, 10 for the second ...

    let info = await lists.info();
    let bulks;
    //console.log(info.doc_count); //전체 갯수
    //console.log(search_value); //전체 갯수
    if (search_value !== null) {
        bulks = await lists.search(
            {
                query: search_value,
                fields: ['title', 'content'],
                skip: skip,
                limit: rows_per_page,
                //sort: [{ id: 'desc' }],
                stale: 'ok',

            }
        );
        console.log(bulks);
        let bulkIds = []
        for (let doc of bulks.rows) {
            //console.log(doc.id);
            bulkIds.push({
                id: doc.id
            });
        }
        //console.log(bulkIds);
        docs = await lists.bulkGet(
            {
                docs: bulkIds
            }
        );
        //console.log(docs);

        if (docs.results !== null) {

            let dds = []
            for (let dd of docs.results) {
                //console.log(dd.docs[0].ok);
                let doc = dd.docs[0].ok;
                dds.push(doc);
            }

            ret = {
                recordsTotal: bulks.total_rows,
                //recordsFiltered: info.doc_count,
                draw: draw,
                data: dds
            }
            result = JSON.stringify(ret);
            res.send(result);
        }
        else {
            res.send({
                data: {}
            });
            return;
        }
    } else {
        docs = await lists.find(
            {
                selector: {},
                skip: skip,
                limit: rows_per_page,
                sort: [{ _id: 'desc' }]
            }
        );
        if (docs !== null) {
            ret = {
                recordsTotal: info.doc_count,
                //recordsFiltered: info.doc_count,
                draw: draw,
                data: docs.docs
            }
            result = JSON.stringify(ret);
            res.send(result);
        }
        else {
            res.send({
                data: {}
            });
            return;
        }
    }

});
app.listen(3000, () => {
    console.log('Server is up and running');
});
lists.createIndex({ index: { fields: ['num'] } });

//* 주소 읽고 디비에 저장
async function updateList(url) {
    let tdlList = [];
    const response = await axios.get(url);
    const $ = cheerio.load(response.data);
    $('div.board-list table tbody tr').each((index, item) => {
        let num = $(item).find('td.num span').text();
        let title1 = $(item).find('td.tit div.text-wrap div a');
        $(title1).children('span').remove().html(); //span제거 카테고리 제거 // 제목만 뽑기위해
        let title = $(title1).text().trim();
        let href = $(item).find('td.tit div a').attr('href');
        let username = $(item).find('td.user span.layerNickName').text();
        let date = $(item).find('td.date').text();
        //세부 게시물 들어가서 링크 따오자
        tdlList[index] = {
            _id: num,
            num: num,
            title: title,
            href: href,
            username: username,
            date: date,
            touched: false
        }
        lists.putIfNotExists(tdlList[index]).then(function (res) {
            // success, res is {rev: '1-xxx', updated: true, id: 'myDocId'}
        }).catch(function (err) {
            console.log(err);
            // error//
        });
    });
}

async function updateContent(url) {
    docs = await lists.find(
        {
            selector: {},
            limit: 5,
            sort: [{ _id: 'desc' }]
        }
    );
    for (let doc of docs.docs) {
        //console.log(doc._id);

        //가장 최근거부터 세부 게시물정보가 있는지 확인하고 업데이트하자
        if (!doc.touched) {
            console.log('[update]', doc.href);
            let response;
            try {
                //response = await axios.get(encodeURI(doc.href));
                //빠른 스캔을 위해 await 말고 then으로 처리 , 병렬처리로 빠름
                axios.get(encodeURI(doc.href)).then(function (response) {
                    const $ = cheerio.load(response.data);
                    let title = $('.articleTitle').html();
                    let articleDate = $('.articleDate').text();
                    let content = $('#powerbbsContent').html();

                    //태그제거
                    title = striptags(title.trim());
                    content = striptags(content.trim());

                    //console.log(title);
                    //console.log(articleDate);//작성일
                    //console.log(content);

                    lists.upsert(doc._id, function (doc) {
                        if (!doc.touched) {
                            doc.touched = true;
                            doc.content = content;
                            doc.articleDate = articleDate;
                            return doc;
                        }
                        return false; // don't update the doc; it's already been "touched"
                    });
                }).catch(error => {
                    console.error(error);
                    lists.upsert(doc._id, function (doc) {
                        if (!doc.touched) {
                            doc.touched = true;
                            return doc;
                        }
                        return false; // don't update the doc; it's already been "touched"
                    });
                })
            } catch (err) {
                //에러나면 터치하고 더이상 업데이트하지 않는다
                //대부분 게시물을 삭제한경우
                lists.upsert(doc._id, function (doc) {
                    if (!doc.touched) {
                        doc.touched = true;
                        return doc;
                    }
                    return false; // don't update the doc; it's already been "touched"
                });
            }
        }
    }
}
function cl(index, object) {
    console.log(index, typeof object, isNumber(object), object)
}
var cjob_updateContent = new CronJob('*/5 * * * * *', updateAll, null, false, 'Asia/Seoul'); //1분마다 0 * * * * *

async function updateAll() {
    console.log('[updateContent][start]', Date.now());
    //1페이지 업데이트
    //https://www.closetoya.com/1.html
    //https://www.inven.co.kr/board/diablo2/5739?category=%EC%8A%A4%ED%83%A0&p=1
    //await updateList("https://www.closetoya.com/1.html");
    await updateList("https://www.inven.co.kr/board/diablo2/5739?category=%EC%8A%A4%ED%83%A0&p=1");
    await updateContent();
    //    console.log('[updateContent][end]', Date.now());
}

(async () => {//
    //텍스트 서치를 위해 인덱스 생성
    lists.search({
        fields: ['title', 'content'],

        build: true
    }).then(function (info) {
        // handle result
        console.log(info);
    }).catch(function (err) {
        // handle error
        console.log(err);
    });
    let docs = await lists.find(
        {
            selector: {},
            sort: [{ _id: 'desc' }]
        }
    );
    console.log("전체 저장된 갯수", Object.keys(docs.docs).length);



    //게시물 안에 들어가서 내용 추출
    await updateAll();
    cjob_updateContent.start();

})();
