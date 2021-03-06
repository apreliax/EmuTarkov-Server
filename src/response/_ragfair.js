"use strict";

require('../libs.js');

function getOffers(request) {
    let response = json.parse(json.read(filepaths.ragfair.search));

    if (Object.entries(request.buildItems).length != 0) {
        createOfferFromBuild(request.buildItems,response);
    } else if (request.handbookId !== "" && request.linkedSearchId !== "") {
        //list specific category from a linked search
        let linkedSearch = getLinkedSearchList(request.linkedSearchId,response);
        let categorySearch = getCategoryList(request.handbookId);

        for (let p1 in categorySearch) {
            for (let search in linkedSearch) {
                if (p1 == search) {
                    response.data.offers.push(createOffer(search, linkedSearch[search]));
                }
            }   
        }
    } else if (request.linkedSearchId !== "") {
        let offers = getLinkedSearchList(request.linkedSearchId,response);

        for (let price in offers) {
            response.data.offers.push(createOffer(price, offers[price]));
        }
    } else if (request.handbookId !== "") {
        let offers = getCategoryList(request.handbookId);

        for (let price in offers) {
            response.data.offers.push(createOffer(price , offers[price]));
        }
    }

    return json.stringify(response);
}

function getLinkedSearchList(linkedSearchId, response) {
    let tableOfItems = {};
    let itemLink = items.data[linkedSearchId];

    response.data.categories = {};

    if (typeof itemLink._props.Slots !== "undefined") {
        for (let itemSlot of itemLink._props.Slots) {
            for (let itemSlotFilter of itemSlot._props.filters) {
                for (let mod of itemSlotFilter.Filter) {
                    for (let item of templates.data.Items) {
                        if (item.Id === mod) {
                            tableOfItems[mod] = item.Price;
                            response.data.categories[mod] = 1;
                        }
                    }
                }
            }
        }
    }

    if (typeof itemLink._props.Chambers !== "undefined") {
        for (let patron of itemLink._props.Chambers[0]._props.filters[0].Filter) {
            for (let item of templates.data.Items) {
                if (item.Id === patron) {
                    tableOfItems[patron] = item.Price;
                    response.data.categories[patron] = 1;
                }   
            }
        }
    }

    return tableOfItems;
}

function getCategoryList(handbookId) {
    let tableOfItems = {};
    let isCateg = false;

    // if its "mods" great-parent category, do double recursive loop
    if (handbookId == "5b5f71a686f77447ed5636ab") {
        for (let categ2 of templates.data.Categories) {
            if (categ2.ParentId === "5b5f71a686f77447ed5636ab") {
                for (let categ3 of templates.data.Categories) {
                    if (categ3.ParentId == categ2.Id) {
                        for (let item of templates.data.Items) {
                            if (item.ParentId === categ3.Id) {
                                tableOfItems[item.Id] = item.Price;
                            }
                        }
                    }
                }
            }
        }
    } else {
        for (let categ of templates.data.Categories) {
            // find the category in the templates
            if (categ.Id === handbookId) {
                isCateg = true;

                // list all item of the category
                for (let item of templates.data.Items) {
                    if (item.ParentId === categ.Id) {
                        tableOfItems[item.Id] = item.Price;
                    }
                }

                // recursive loops for sub categories
                for (let categ2 of templates.data.Categories) {
                    if (categ2.ParentId === categ.Id) {
                        for (let item of templates.data.Items) {
                            if (item.ParentId === categ2.Id) {
                                tableOfItems[item.Id] = item.Price;
                            }   
                        }
                    }
                }
            }
        }

        // its a specific item searched then
        if (isCateg === false) {
            for (let curItem in items.data) {
                if (curItem === handbookId) {
                    for (let item of templates.data.Items) {
                        if (item.Id === handbookId) {
                            tableOfItems[curItem] = item.Price;
                        }
                    }

                    break;
                }
            }
        }
    }

    return tableOfItems;
}

function createOfferFromBuild(buildItems,response) {
    for (var itemFromBuild in buildItems) {
        for (let curItem in items.data) {
            if (curItem === itemFromBuild) {
                for (let item of templates.data.Items) {
                    if (item.Id === itemFromBuild) {
                        response.data.offers.push(createOffer(curItem, item.Price));
                        break;
                    }
                }

                break;
            }
        }
    }

    return response
}

function createOffer(template, price) {
    let offerBase = json.parse(json.read(filepaths.ragfair.offer));

    offerBase._id = template;
    offerBase.items[0]._tpl = template;
    offerBase.requirements[0].count = Math.round(price * settings.gameplay.trading.ragfairMultiplier);;
	//offerBase.startTime = utility.getTimestamp() - 1000;
    //offerBase.endTime = utility.getTimestamp() + 43200;
    
    return offerBase;
}

module.exports.getOffers = getOffers;