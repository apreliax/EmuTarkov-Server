"use strict";

require('../libs.js');

/* Made a 2d array table with 0 - free slot and 1 - used slot
* input: PlayerData
* output: table[y][x]
* */
function recheckInventoryFreeSpace(pmcData, sessionID) { // recalculate stach taken place
    let PlayerStash = getPlayerStash(sessionID);
    let Stash2D = Array(PlayerStash[1]).fill(0).map(x => Array(PlayerStash[0]).fill(0));
    for (let item of pmcData.Inventory.items) {
        // hideout  // added proper stash ID older was "5c71b934354682353958ea35"
        if (item.parentId === pmcData.Inventory.stash && typeof item.location != "undefined") {
            // let tmpItem = getItem(item._tpl)[1];
            let tmpSize = getSize(item._tpl, item._id, pmcData.Inventory.items);
            //			x
            let iW = tmpSize[0];
            //			y
            let iH = tmpSize[1];
            if (typeof item.upd != "undefined")
                if (typeof item.upd.Foldable != "undefined")
                    if (item.upd.Foldable.Folded) {
                        iW -= 1;
                    }

            let fH = ((item.location.r === "Vertical" || item.location.rotation === "Vertical") ? iW : iH);
            let fW = ((item.location.r === "Vertical" || item.location.rotation === "Vertical") ? iH : iW);


            for (let y = 0; y < fH; y++) {
                if (item.location.y + y <= PlayerStash[1] && item.location.x + fW <= PlayerStash[0]) { // fixed filling out of bound
                    let FillTo = ((item.location.x + fW >= PlayerStash[0]) ? PlayerStash[0] : item.location.x + fW);
                    try {
                        Stash2D[item.location.y + y].fill(1, item.location.x, FillTo);
                    } catch (e) {
                        logger.logError("[OOB] for item " + item._id + " [" + item._id + "] with error message: " + e);
                    }
                }
            }
        }
    }

    return Stash2D;
}

function isMoneyTpl(tpl) {
    const moneyTplArray = ['569668774bdc2da2298b4568', '5696686a4bdc2da3298b456a', '5449016a4bdc2d6f028b456f'];
    return moneyTplArray.findIndex(moneyTlp => moneyTlp === tpl) > -1;
}

/* Gets currency TPL from TAG
* input: currency(tag)
* output: template ID
* */
function getCurrency(currency) {
    switch (currency) {
        case "EUR":
            return "569668774bdc2da2298b4568";
        case "USD":
            return "5696686a4bdc2da3298b456a";
        default:
            return "5449016a4bdc2d6f028b456f"; // RUB set by default
    }
}

/* Gets Currency to Ruble conversion Value
* input:  value, currency tpl
* output: value after conversion
*/
function inRUB(value, currency) {
    for (let template of templates.data.Items) {
        if (template.Id === currency) {
            return Math.round(value * template.Price);
        }
    }
    
    return value;
}

/* Gets Ruble to Currency conversion Value
* input: value, currency tpl
* output: value after conversion
* */
function fromRUB(value, currency) {
    for (let template of templates.data.Items) {
        if (template.Id === currency) {
            return Math.round(value / template.Price);
        }
    }
    
    return value;
}

/* take money and insert items into return to server request
* input:
* output: boolean
* */
function payMoney(pmcData, body, sessionID) {
    item.resetOutput();
    let output = item.getOutput();
    let tmpTraderInfo = trader.get(body.tid, sessionID);
    let currencyTpl = getCurrency(tmpTraderInfo.data.currency);

    // delete barter things(not a money) from inventory
    if (body.Action === 'TradingConfirm') {
        for (let index in body.scheme_items) {
            let item = undefined;

            for (let element of pmcData.Inventory.items) {
                if (body.scheme_items[index].id === element._id) {
                    item = element;
                }
            }

            if (item !== undefined) {
                if (!isMoneyTpl(item._tpl)) {
                    output = move_f.removeItem(pmcData, item._id, output, sessionID);
                    body.scheme_items[index].count = 0;
                } else {
                    currencyTpl = item._tpl;
                    break;
                }
            }
        }
    }

    // find all items with currency _tpl id
    const moneyItems = itm_hf.findMoney("tpl", pmcData, currencyTpl);

    // prepare a price for barter
    let barterPrice = 0;
    
    for (let item of body.scheme_items) {
        barterPrice += item.count;
    }

    // prepare the amount of money in the profile
    let amountMoney = 0;
    
    for (let item of moneyItems) {
        amountMoney += item.upd.StackObjectsCount;
    }

    // if no money in inventory or amount is not enough we return false
    if (moneyItems.length <= 0 || amountMoney < barterPrice) {
        return false;
    }

    let leftToPay = barterPrice;

    for (let moneyItem of moneyItems) {
        let itemAmount = moneyItem.upd.StackObjectsCount;

        if (leftToPay >= itemAmount) {
            leftToPay -= itemAmount;
            output = move_f.removeItem(pmcData, moneyItem._id, output);
        } else {
            moneyItem.upd.StackObjectsCount -= leftToPay;
            leftToPay = 0;
            output.data.items.change.push(moneyItem);
        }

        if (leftToPay === 0) {
            break;
        }
    }

    // set current sale sum
    // convert barterPrice itemTpl into RUB then convert RUB into trader currency
    let saleSum = tmpTraderInfo.data.loyalty.currentSalesSum + fromRUB(inRUB(barterPrice, currencyTpl), getCurrency(tmpTraderInfo.data.currency));

    tmpTraderInfo.data.loyalty.currentSalesSum = saleSum;
    trader.setTrader(tmpTraderInfo.data, sessionID);
    trader.lvlUp(body.tid, sessionID);
    output.data.currentSalesSums[body.tid] = saleSum;

    // save changes
    profile_f.setPmcData(pmcData, sessionID);
    logger.logSuccess("Items taken. Status OK.");
    item.setOutput(output);
    return true;
}

/* Find Barter items in the inventory
* input: object of player data, string BarteredItem ID
* output: array of Item from inventory
* */
function findMoney(by, pmcData, barter_itemID) { // find required items to take after buying (handles multiple items)
    const barterIDs = typeof barter_itemID === "string" ? [barter_itemID] : barter_itemID;
    let itemsArray = [];

    for (const barterID of barterIDs) {
        let mapResult = pmcData.Inventory.items.filter(item => {
            return by === "tpl" ? (item._tpl === barterID) : (item._id === barterID);
        });
        itemsArray = Object.assign(itemsArray, mapResult);
    }

    return itemsArray;
}

/* receive money back after selling
* input: pmcData, numberToReturn, request.body,
* output: none (output is sended to item.js, and profile is saved to file)
* */
function getMoney(pmcData, amount, body, output, sessionID) {
    let tmpTraderInfo = trader.get(body.tid, sessionID);
    let currency = getCurrency(tmpTraderInfo.data.currency);
    let calcAmount = fromRUB(inRUB(amount, currency), currency);
    let skip = false;

    for (let item of pmcData.Inventory.items) {
        // item is not currency
        if (item._tpl !== currency) {
            continue;
        }

        // too much money for a stack
        if (item.upd.StackObjectsCount + calcAmount > 500000) {
            // calculate difference
            let tmp = item.upd.StackObjectsCount;
            let difference = 500000 - tmp;

            // make stack max money, then look further
            item.upd.StackObjectsCount = 500000;
            output.data.items.change.push(item);
            calcAmount -= difference;
            continue;
        }

        // receive money
        item.upd.StackObjectsCount += calcAmount;
        output.data.items.change.push(item);
        logger.logSuccess("Money received: " + amount + " " + tmpTraderInfo.data.currency);
        skip = true;
        break;
    }

    if (!skip) {
        let StashFS_2D = recheckInventoryFreeSpace(pmcData);

        // creating item
        let stashSize = getPlayerStash();

        addedMoney:
            for (let My = 0; My <= stashSize[1]; My++) {
                for (let Mx = 0; Mx <= stashSize[0]; Mx++) {
                    let skip0 = false;

                    if (StashFS_2D[My][Mx] !== 0) {
                        skip0 = true;
                    }

                    if (!skip0) {
                        let MoneyItem = {
                            "_id": utility.generateNewItemId(),
                            "_tpl": currency,
                            "parentId": pmcData.Inventory.stash,
                            "slotId": "hideout",
                            "location": {x: Mx, y: My, r: "Horizontal"},
                            "upd": {"StackObjectsCount": calcAmount}
                        };

                        pmcData.Inventory.items.push(MoneyItem);
                        output.data.items.new.push(MoneyItem);
                        logger.logSuccess("Money created: " + calcAmount + " " + tmpTraderInfo.data.currency);
                        break addedMoney;
                    }
                }
            }
    }

    // set current sale sum
    let saleSum = tmpTraderInfo.data.loyalty.currentSalesSum += amount;

    tmpTraderInfo.data.loyalty.currentSalesSum = saleSum;
    trader.setTrader(tmpTraderInfo.data, sessionID);
    trader.lvlUp(body.tid, sessionID);
    output.data.currentSalesSums[body.tid] = saleSum;

    profile_f.setPmcData(pmcData, sessionID);
    return output;
}

/* Get Player Stash Proper Size
* input: null
* output: [stashSizeWidth, stashSizeHeight]
* */
function getPlayerStash(sessionID) { //this sets automaticly a stash size from items.json (its not added anywhere yet cause we still use base stash)
    let stashTPL = profile_f.getStashType(sessionID);
    let stashX = (items.data[stashTPL]._props.Grids[0]._props.cellsH !== 0) ? items.data[stashTPL]._props.Grids[0]._props.cellsH : 10;
    let stashY = (items.data[stashTPL]._props.Grids[0]._props.cellsV !== 0) ? items.data[stashTPL]._props.Grids[0]._props.cellsV : 66;
    return [stashX, stashY];
}

/* Gets item data from items.json
* input: Item Template ID
* output: [ItemFound?(true,false), itemData]
* */
function getItem(template) { // -> Gets item from <input: _tpl>
    for (let itm in items.data) {
        if (items.data.hasOwnProperty(itm)) {
            if (items.data[itm]._id && items.data[itm]._id === template) {
                let item = items.data[itm];
                return [true, item];
            }
        }
    }
    return [false, {}];
}

/* Calculate Size of item inputed
* inputs Item template ID, Item Id, InventoryItem (item from inventory having _id and _tpl)
* outputs [width, height]
* */
function getSize(itemtpl, itemID, InventoryItem) { // -> Prepares item Width and height returns [sizeX, sizeY]
    let toDo = [itemID],
        rootItem = itemID,
        tmpItem = getItem(itemtpl)[1],
        isFolded = false,
        isMagazine = false,
        isGrip = false,
        isMainBaseHasis = false,
        isBarrel = false,
        BxH_diffrence_stock = 0,
        BxH_diffrence_barrel = 0;


    let outX = tmpItem._props.Width;
    let outY = tmpItem._props.Height;
    let skipThisItems = ["5448e53e4bdc2d60728b4567", "566168634bdc2d144c8b456c", "5795f317245977243854e041"];

    if (skipThisItems.indexOf(tmpItem._parent) === -1) { // containers big no no
        while (true) {
            if (typeof toDo[0] === "undefined") {
                break;
            }
            for (let tmpKey in InventoryItem) {
                if (InventoryItem.hasOwnProperty(tmpKey)) {
                    if (InventoryItem[tmpKey]._id == toDo[0]) {
                        if (typeof InventoryItem[tmpKey].upd != "undefined")
                            if (typeof InventoryItem[tmpKey].upd.Foldable != "undefined")
                                if (InventoryItem[tmpKey].upd.Foldable.Folded === true)
                                    isFolded = true;
                    }
                    if (InventoryItem[tmpKey].parentId === toDo[0]) {
                        let itm = getItem(InventoryItem[tmpKey]._tpl)[1];
                        //if(rootItem === InventoryItem[tmpKey].parentId || itm._props.ExtraSizeForceAdd == true) {
                        if (InventoryItem[tmpKey].slotId != "mod_handguard") {
                            if (InventoryItem[tmpKey].slotId == "mod_magazine") {
                                if (typeof itm._props.ExtraSizeDown !== "undefined" && itm._props.ExtraSizeDown > 0) {
                                    isMagazine = true;
                                }
                            }
                            if (InventoryItem[tmpKey].slotId == "mod_pistol_grip" || InventoryItem[tmpKey].slotId == "mod_pistolgrip") {

                                isGrip = true;
                            }
                            if (InventoryItem[tmpKey].slotId == "mod_stock") {
                                if (typeof itm._props.ExtraSizeDown !== "undefined" && itm._props.ExtraSizeDown > 0) {
                                    isGrip = true;
                                }
                            }
                            if (InventoryItem[tmpKey].slotId == "mod_stock") {
                                if (typeof itm._props.ExtraSizeLeft !== "undefined" && itm._props.ExtraSizeLeft > 0) {
                                    BxH_diffrence_stock = itm._props.ExtraSizeLeft;
                                    isMainBaseHasis = true;
                                }
                            }
                            if (InventoryItem[tmpKey].slotId == "mod_barrel") {
                                if (typeof itm._props.ExtraSizeLeft !== "undefined" && itm._props.ExtraSizeLeft > 0) {
                                    BxH_diffrence_barrel = itm._props.ExtraSizeLeft;
                                    isBarrel = true;
                                }
                            }
                            if (typeof itm._props.ExtraSizeLeft !== "undefined" && itm._props.ExtraSizeLeft > 0) {
                                if (InventoryItem[tmpKey].slotId == "mod_barrel" && itm._props.ExtraSizeLeft > 1 || InventoryItem[tmpKey].slotId != "mod_barrel")
                                    outX += itm._props.ExtraSizeLeft;
                            }

                            if (typeof itm._props.ExtraSizeRight !== "undefined" && itm._props.ExtraSizeRight > 0) {
                                outX += itm._props.ExtraSizeRight;
                            }

                            if (typeof itm._props.ExtraSizeUp !== "undefined" && itm._props.ExtraSizeUp > 0) {
                                outY += itm._props.ExtraSizeUp;
                            }

                            if (typeof itm._props.ExtraSizeDown !== "undefined" && itm._props.ExtraSizeDown > 0) {
                                outY += itm._props.ExtraSizeDown;
                            }
                        }
                        toDo.push(InventoryItem[tmpKey]._id);
                    }
                }
            }
            toDo.splice(0, 1);
        }
    }
    if (isBarrel && isMainBaseHasis) {
        let calculate = Math.abs(BxH_diffrence_stock - BxH_diffrence_barrel);
        calculate = ((BxH_diffrence_stock > BxH_diffrence_barrel) ? BxH_diffrence_stock : BxH_diffrence_barrel) - calculate;
        outX -= calculate;
    }
    if (isMagazine && isGrip)
        outY -= 1;
    if (isFolded)
        outX -= 1;
    return [outX, outY];
}

/* Find And Return Children (TRegular)
* input: PlayerData, InitialItem._id
* output: list of item._id
* List is backward first item is the furthest child and last item is main item
* returns all child items ids in array, includes itself and children
* */
function findAndReturnChildren(pmcData, itemid) {
    let list = [];

    for (let childitem of pmcData.Inventory.items) {
        if (childitem.parentId === itemid) {
            list.push.apply(list, findAndReturnChildren(pmcData, childitem._id));
        }
    }

    list.push(itemid);// it's required
    return list;
}

/* Is Dogtag
* input: itemId
* output: bool
* Checks if an item is a dogtag. Used under profile_f.js to modify preparePrice based
* on the level of the dogtag
*/
function isDogtag(itemId) {
    return itemId === "59f32bb586f774757e1e8442" || itemId === "59f32c3b86f77472a31742f0" ? true : false;
}

module.exports.recheckInventoryFreeSpace = recheckInventoryFreeSpace;
module.exports.getCurrency = getCurrency;
module.exports.inRUB = inRUB;
module.exports.fromRUB = fromRUB;
module.exports.payMoney = payMoney;
module.exports.findMoney = findMoney;
module.exports.getMoney = getMoney;
module.exports.getPlayerStash = getPlayerStash;
module.exports.getItem = getItem;
module.exports.getSize = getSize;
module.exports.findAndReturnChildren = findAndReturnChildren;
module.exports.isDogtag = isDogtag;
