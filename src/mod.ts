import { DependencyContainer } from "tsyringe";

import Ajv, { ValidateFunction } from "ajv";
import addFormats from "ajv-formats";

import { IPreSptLoadMod } from "@spt/models/external/IPreSptLoadMod";
import { IPostDBLoadMod } from "@spt/models/external/IPostDBLoadMod";
import { ILogger } from "@spt/models/spt/utils/ILogger";
import { PreSptModLoader } from "@spt/loaders/PreSptModLoader";
import { DatabaseServer } from "@spt/servers/DatabaseServer";
import { ImageRouter } from "@spt/routers/ImageRouter";
import { ConfigServer } from "@spt/servers/ConfigServer";
import { ConfigTypes } from "@spt/models/enums/ConfigTypes";
import { ITraderConfig } from "@spt/models/spt/config/ITraderConfig";
import { JsonUtil } from "@spt/utils/JsonUtil";
import { TradeController } from "@spt/controllers/TradeController";
import { ProfileController } from "@spt/controllers/ProfileController";
import { HashUtil } from "@spt/utils/HashUtil";
import { CustomItemService } from "@spt/services/mod/CustomItemService";
import { IProcessBuyTradeRequestData } from "@spt/models/eft/trade/IProcessBuyTradeRequestData";
import { IProcessSellTradeRequestData } from "@spt/models/eft/trade/IProcessSellTradeRequestData";

import * as trader from "../db/trader.json";
import * as skills from "../db/skills.json";
import * as config from "../config/config.json";
import { Money } from "@spt/models/enums/Money";
import { TraderHelper } from "./traderHelpers";
import { Traders } from "@spt/models/enums/Traders";
import { FluentAssortConstructor } from "./fluentTraderAssortCreator";
import { IDatabaseTables } from "@spt/models/spt/server/IDatabaseTables";
import { IPmcData } from "@spt/models/eft/common/IPmcData";
import { IProcessBaseTradeRequestData } from "@spt/models/eft/trade/IProcessBaseTradeRequestData";
import { TradeHelper } from "@spt/helpers/TradeHelper";
import { PaymentService } from "@spt/services/PaymentService";
import { EventOutputHolder } from "@spt/routers/EventOutputHolder";
import { NewItemFromCloneDetails } from "@spt/models/spt/mod/NewItemDetails";
import { healthPurchasesSchema } from "./healthPurchasesSchema";
import { HealthPurchaseRecord } from "./types";
import { HealthPurchases } from "./types";
import * as fs from "fs";
import path from "path";
import { ProfileHelper } from "@spt/helpers/ProfileHelper";
import { StaticRouterModService } from "@spt/services/mod/staticRouter/StaticRouterModService";
import { IItemEventRouterResponse } from "@spt/models/eft/itemEvent/IItemEventRouterResponse";
import { SkillTypes } from "@spt/models/enums/SkillTypes";
import { IItemConfig } from "@spt/models/spt/config/IItemConfig";

const bandPhysicalID = "5b3f16c486f7747c327f55f7";
const bandMentalID = "5b3f3b0186f774021a2afef7";
const bandPracticalID = "5b3f3b0e86f7746752107cda";
const bandCombatID = "5b3f3ade86f7746b6b790d8e";
const bandCharacterID = "619bddffc9546643a67df6f0";

const bandPhysicalHandbookID = "5b47574386f77428ca22b346";
const bandMentalHandbookID = "5b5f78dc86f77409407a7f8e";
const bandPracticalHandbookID = "5b5f71a686f77447ed5636ab";
const bandCombatHandbookID = "5b47574386f77428ca22b33f";
const bandCharacterHandbookID = "5b47574386f77428ca22b33e";
const bandHealthHandbookID = "5b47574386f77428ca22b340";
const bandWeightHandbookID = "5b47574386f77428ca22b344";

const bandExperienceIDSuffix = " Training Band"
const bandExperienceTradeIDSuffix = " Training Band Trade"

const bandWeightID = "619bdeb986e01e16f839a99e";
const bandWeightIDSuffix = "Weight Band"
const bandWeightTradeIDSuffix = "Weight Band Trade"

const bandHealthID = "619bddffc9546643a67df6f0";
const bandHealthIDSuffix = " Health Band"
const bandHealthTradeIDSuffix = " Health Band Trade"
const healthPurchaseHistoryFile = "../data/healthPurchases.json";

class CharacterHealthTrader implements IPreSptLoadMod, IPostDBLoadMod
{
    private mod: string
    private static logger: ILogger

    private static container: DependencyContainer;

    constructor() 
    {
        this.mod = "skulltag-personaltrainer-1.0.3"; // See? I changed it this time.
    }
    
    preSptLoad(container: DependencyContainer): void 
    {
        CharacterHealthTrader.container = container;
        CharacterHealthTrader.logger = container.resolve<ILogger>("WinstonLogger");
        
        const preAkiModLoader: PreSptModLoader = container.resolve<PreSptModLoader>("PreSptModLoader");
        const imageRouter: ImageRouter = container.resolve<ImageRouter>("ImageRouter");
        const configServer = container.resolve<ConfigServer>("ConfigServer");
        const traderHelper = new TraderHelper();

        const traderConfig: ITraderConfig = configServer.getConfig<ITraderConfig>(ConfigTypes.TRADER);

        container.register<ProfileController>("ProfileControllerOriginal", ProfileController);

        traderHelper.registerProfileImage(trader, this.mod, preAkiModLoader, imageRouter, "coach.jpg");
        traderHelper.setTraderUpdateTime(traderConfig, trader, 3600, 4000);
        container.afterResolution(
            "TradeController",
            (_t, result: TradeController) => {
                result.confirmTrading = this.buyHealthOrExperience;
            },
            {frequency: "Always"});
        
        const staticRMS = container.resolve<StaticRouterModService>("StaticRouterModService");

        staticRMS.registerStaticRouter("CharacterHealthTrader", [
            {
                url: "/client/game/start",
                action: async (url, info, sessionID, output) => 
                {
                    try 
                    {
                        CharacterHealthTrader.calculateHealthValues(sessionID);
                    } 
                    catch (error) 
                    {
                        CharacterHealthTrader.logger.error("Test" + error.message);
                        CharacterHealthTrader.setDefaultWeightLimits();
                    }
                    return output;
                }
            },
            {
                url: "/client/items",
                action: async (url, info, sessionID, output) => 
                {
                    try 
                    {
                        CharacterHealthTrader.calculateHealthValues(sessionID);
                    } 
                    catch (error) 
                    {
                        CharacterHealthTrader.logger.error("Test" + error.message);
                        CharacterHealthTrader.setDefaultWeightLimits();
                    }
                    return output;
                }
            }
        ], "aki");

        Traders[trader._id] = trader._id;
    }

    buyHealthOrExperience(pmcData: IPmcData, request: IProcessBaseTradeRequestData, sessionID: string) : IItemEventRouterResponse
    {
        const tradeHelper = CharacterHealthTrader.container.resolve<TradeHelper>("TradeHelper");
        const eventOutputHolder: EventOutputHolder = CharacterHealthTrader.container.resolve<EventOutputHolder>("EventOutputHolder");
        const output = eventOutputHolder.getOutput(sessionID);

        // selling
        if (request.type === "sell_to_trader")
        {
            const sellData = <IProcessSellTradeRequestData>request;
            tradeHelper.sellItem(pmcData, pmcData, sellData, sessionID, output);
            return output;
        }

        // buying
        if (request.type === "buy_from_trader")
        {
            const paymentService = CharacterHealthTrader.container.resolve<PaymentService>("PaymentService");
            const profileHelper = CharacterHealthTrader.container.resolve<ProfileHelper>("ProfileHelper");
            
            const buyData = <IProcessBuyTradeRequestData>request;

            if (buyData.item_id.endsWith(bandExperienceTradeIDSuffix))
            {
                const length = bandExperienceTradeIDSuffix.length;
                const skillName = buyData.item_id.slice(0, buyData.item_id.length - length);
                if (skillName === "Character")
                {
                    pmcData.Info.Experience += config.characterExp * buyData.count;
                }
                else
                {
                    profileHelper.addSkillPointsToPlayer(pmcData, skillName as SkillTypes, config.skillExp * buyData.count);
                }

                paymentService.payMoney(pmcData, buyData, sessionID, output);
                return output;
            }
            
            if (buyData.item_id.endsWith(bandHealthTradeIDSuffix))
            {
                const ajv = new Ajv();
                addFormats(ajv);
                const validateSchema: ValidateFunction<unknown> = ajv.compile(healthPurchasesSchema.schema);
                const healthPurchases: HealthPurchases = CharacterHealthTrader.loadHealthPurchaseHistory(validateSchema);
                const healthPurchaseRecord: HealthPurchaseRecord =  CharacterHealthTrader.getHealthPurchaseRecord(pmcData._id, healthPurchases);
                const profileHelper:ProfileHelper = CharacterHealthTrader.container.resolve<ProfileHelper>("ProfileHelper");
                
                const length = bandHealthTradeIDSuffix.length;
                const bodyPart = buyData.item_id.slice(0, buyData.item_id.length - length);

                if (bodyPart === "Head")
                    healthPurchaseRecord.headHealthPurchases += buyData.count;
                
                else if (bodyPart === "Chest")
                    healthPurchaseRecord.chestHealthPurchases += buyData.count;

                else if (bodyPart === "Stomach")
                    healthPurchaseRecord.stomachHealthPurchases += buyData.count;
                
                else if (bodyPart === "LeftLeg")
                    healthPurchaseRecord.leftLegHealthPurchases += buyData.count;
            
                else if (bodyPart === "RightLeg")
                    healthPurchaseRecord.rightLegHealthPurchases += buyData.count;
            
                else if (bodyPart === "LeftArm")
                    healthPurchaseRecord.leftArmHealthPurchases += buyData.count;
            
                else if (bodyPart === "RightArm")
                    healthPurchaseRecord.rightArmHealthPurchases += buyData.count;

                const scavData = profileHelper.getScavProfile(sessionID);
                CharacterHealthTrader.setPmcHealthValues(pmcData, healthPurchaseRecord);
                CharacterHealthTrader.setScavHealthValues(scavData, healthPurchaseRecord);
                CharacterHealthTrader.saveHealthPurchaseHistory(validateSchema, healthPurchases);
                
                paymentService.payMoney(pmcData, buyData, sessionID, output);
                return output;
            }

            if (buyData.item_id.endsWith(bandWeightTradeIDSuffix))
            {
                const ajv = new Ajv();
                addFormats(ajv);
                const validateSchema: ValidateFunction<unknown> = ajv.compile(healthPurchasesSchema.schema);
                const healthPurchases: HealthPurchases = CharacterHealthTrader.loadHealthPurchaseHistory(validateSchema);
                const healthPurchaseRecord: HealthPurchaseRecord = CharacterHealthTrader.getHealthPurchaseRecord(pmcData._id, healthPurchases);

                healthPurchaseRecord.weightLimitIncreasePurchases += buyData.count;
                CharacterHealthTrader.setWeightLimits(healthPurchaseRecord);
                CharacterHealthTrader.saveHealthPurchaseHistory(validateSchema, healthPurchases);
                paymentService.payMoney(pmcData, buyData, sessionID, output);
                return output;
            }

            const configServer = CharacterHealthTrader.container.resolve<ConfigServer>("ConfigServer");
            const traderConfig = configServer.getConfig<ITraderConfig>(ConfigTypes.TRADER);
            tradeHelper.buyItem(pmcData, buyData, sessionID, traderConfig.purchasesAreFoundInRaid, output);
            return output;
        }
    }

    static calculateHealthValues(sessionID: string)
    {
        const profileHelper:ProfileHelper = CharacterHealthTrader.container.resolve<ProfileHelper>("ProfileHelper");
        const pmcData: IPmcData = profileHelper.getPmcProfile(sessionID);
        if (pmcData.Health == undefined)
            return;

        const scavData: IPmcData = profileHelper.getScavProfile(sessionID);
        
        const ajv = new Ajv();
        addFormats(ajv);
        const validateSchema: ValidateFunction<unknown> = ajv.compile(healthPurchasesSchema.schema);
        const healthPurchases: HealthPurchases = CharacterHealthTrader.loadHealthPurchaseHistory(validateSchema);
        const healthPurchaseRecord: HealthPurchaseRecord =  CharacterHealthTrader.getHealthPurchaseRecord(pmcData._id, healthPurchases);
        
        CharacterHealthTrader.setPmcHealthValues(pmcData, healthPurchaseRecord);
        CharacterHealthTrader.setScavHealthValues(scavData, healthPurchaseRecord);
        CharacterHealthTrader.setWeightLimits(healthPurchaseRecord);
    }

    static setPmcHealthValues(pmcData: IPmcData, healthPurchaseRecord: HealthPurchaseRecord)
    {
        const pmcHealthLevel = config.enableHealthPerLevel ? pmcData.Info.Level - 1 : 0;
        
        const headHealthPurchases = config.enableHealthPurchases ? healthPurchaseRecord.headHealthPurchases : 0;
        const stomachHealthPurchases = config.enableHealthPurchases ? healthPurchaseRecord.stomachHealthPurchases : 0;
        const chestHealthPurchases = config.enableHealthPurchases ? healthPurchaseRecord.chestHealthPurchases : 0;
        const leftArmHealthPurchases = config.enableHealthPurchases ? healthPurchaseRecord.leftArmHealthPurchases : 0;
        const rightArmHealthPurchases = config.enableHealthPurchases ? healthPurchaseRecord.rightArmHealthPurchases : 0;
        const leftLegHealthPurchases = config.enableHealthPurchases ? healthPurchaseRecord.leftLegHealthPurchases : 0;
        const rightLegHealthPurchases = config.enableHealthPurchases ? healthPurchaseRecord.rightLegHealthPurchases : 0;

        pmcData.Health.BodyParts.Head.Health.Maximum = config.headHealthBase + pmcHealthLevel * config.headHealthPerLevel + headHealthPurchases * config.headHealthPerPurchase;
        pmcData.Health.BodyParts.Stomach.Health.Maximum = config.stomachHealthBase + pmcHealthLevel * config.stomachHealthPerLevel + stomachHealthPurchases * config.stomachHealthPerPurchase;
        pmcData.Health.BodyParts.Chest.Health.Maximum = config.chestHealthBase + pmcHealthLevel * config.chestHealthPerLevel + chestHealthPurchases * config.chestHealthPerPurchase;
        pmcData.Health.BodyParts.LeftArm.Health.Maximum = config.leftArmHealthBase + pmcHealthLevel * config.leftArmHealthPerLevel + leftArmHealthPurchases * config.leftArmHealthPerPurchase;
        pmcData.Health.BodyParts.RightArm.Health.Maximum = config.rightArmHealthBase + pmcHealthLevel * config.rightArmHealthPerLevel + rightArmHealthPurchases * config.rightArmHealthPerPurchase;
        pmcData.Health.BodyParts.LeftLeg.Health.Maximum = config.leftLegHealthBase + pmcHealthLevel * config.leftLegHealthPerLevel + leftLegHealthPurchases * config.leftLegHealthPerPurchase;
        pmcData.Health.BodyParts.RightLeg.Health.Maximum = config.rightLegHealthBase + pmcHealthLevel * config.rightLegHealthPerLevel + rightLegHealthPurchases * config.rightLegHealthPerPurchase;
    }

    static setScavHealthValues(pmcData: IPmcData, healthPurchaseRecord: HealthPurchaseRecord)
    {
        const pmcHealthLevel = config.enableHealthPerLevel ? pmcData.Info.Level - 1 : 0;

        const headHealthPurchases = config.enableHealthPurchases ? healthPurchaseRecord.headHealthPurchases : 0;
        const stomachHealthPurchases = config.enableHealthPurchases ? healthPurchaseRecord.stomachHealthPurchases : 0;
        const chestHealthPurchases = config.enableHealthPurchases ? healthPurchaseRecord.chestHealthPurchases : 0;
        const leftArmHealthPurchases = config.enableHealthPurchases ? healthPurchaseRecord.leftArmHealthPurchases : 0;
        const rightArmHealthPurchases = config.enableHealthPurchases ? healthPurchaseRecord.rightArmHealthPurchases : 0;
        const leftLegHealthPurchases = config.enableHealthPurchases ? healthPurchaseRecord.leftLegHealthPurchases : 0;
        const rightLegHealthPurchases = config.enableHealthPurchases ? healthPurchaseRecord.rightLegHealthPurchases : 0;

        pmcData.Health.BodyParts.Head.Health.Maximum = config.headHealthBase + pmcHealthLevel * config.headHealthPerLevel + headHealthPurchases * config.headHealthPerPurchase;
        pmcData.Health.BodyParts.Stomach.Health.Maximum = config.stomachHealthBase + pmcHealthLevel * config.stomachHealthPerLevel + stomachHealthPurchases * config.stomachHealthPerPurchase;
        pmcData.Health.BodyParts.Chest.Health.Maximum = config.chestHealthBase + pmcHealthLevel * config.chestHealthPerLevel + chestHealthPurchases * config.chestHealthPerPurchase;
        pmcData.Health.BodyParts.LeftArm.Health.Maximum = config.leftArmHealthBase + pmcHealthLevel * config.leftArmHealthPerLevel + leftArmHealthPurchases * config.leftArmHealthPerPurchase;
        pmcData.Health.BodyParts.RightArm.Health.Maximum = config.rightArmHealthBase + pmcHealthLevel * config.rightArmHealthPerLevel + rightArmHealthPurchases * config.rightArmHealthPerPurchase;
        pmcData.Health.BodyParts.LeftLeg.Health.Maximum = config.leftLegHealthBase + pmcHealthLevel * config.leftLegHealthPerLevel + leftLegHealthPurchases * config.leftLegHealthPerPurchase;
        pmcData.Health.BodyParts.RightLeg.Health.Maximum = config.rightLegHealthBase + pmcHealthLevel * config.rightLegHealthPerLevel + rightLegHealthPurchases * config.rightLegHealthPerPurchase;

        pmcData.Health.BodyParts.Head.Health.Current = pmcData.Health.BodyParts.Head.Health.Maximum;
        pmcData.Health.BodyParts.Stomach.Health.Current = pmcData.Health.BodyParts.Stomach.Health.Maximum;
        pmcData.Health.BodyParts.Chest.Health.Current = pmcData.Health.BodyParts.Chest.Health.Maximum;
        pmcData.Health.BodyParts.LeftArm.Health.Current = pmcData.Health.BodyParts.LeftArm.Health.Maximum;
        pmcData.Health.BodyParts.RightArm.Health.Current = pmcData.Health.BodyParts.RightArm.Health.Maximum;
        pmcData.Health.BodyParts.LeftLeg.Health.Current = pmcData.Health.BodyParts.LeftLeg.Health.Maximum;
        pmcData.Health.BodyParts.RightLeg.Health.Current = pmcData.Health.BodyParts.RightLeg.Health.Maximum;
    }

    static setDefaultWeightLimits()
    {
        const databaseServer:DatabaseServer = CharacterHealthTrader.container.resolve<DatabaseServer>("DatabaseServer");
        const globals = databaseServer.getTables().globals.config;
        globals.Stamina.BaseOverweightLimits.x = config.standOverWeightLimitBaseX;
        globals.Stamina.BaseOverweightLimits.y = config.standOverWeightLimitBaseY;
        
        globals.Stamina.WalkSpeedOverweightLimits.x = config.walkSpeedOverWeightLimitBaseX;
        globals.Stamina.WalkSpeedOverweightLimits.y = config.walkSpeedOverWeightLimitBaseY;

        globals.Stamina.WalkOverweightLimits.x = config.walkOverWeightLimitBaseX;
        globals.Stamina.WalkOverweightLimits.y = config.walkOverWeightLimitBaseY;
        
        globals.Stamina.SprintOverweightLimits.x = config.sprintOverWeightLimitBaseX;
        globals.Stamina.SprintOverweightLimits.y = config.sprintOverWeightLimitBaseY;
    }

    static setWeightLimits(healthPurchaseRecord: HealthPurchaseRecord)
    {
        if (!config.enableWeightLimitPurchase)
        {
            this.setDefaultWeightLimits();
            return;
        }

        const databaseServer:DatabaseServer = CharacterHealthTrader.container.resolve<DatabaseServer>("DatabaseServer");
        const globals = databaseServer.getTables().globals.config;

        globals.Stamina.BaseOverweightLimits.x = config.standOverWeightLimitBaseX + config.standOverWeightLimitPerPurchaseX * healthPurchaseRecord.weightLimitIncreasePurchases;
        globals.Stamina.BaseOverweightLimits.y = config.standOverWeightLimitBaseY + config.standOverWeightLimitPerPurchaseY * healthPurchaseRecord.weightLimitIncreasePurchases;
        
        globals.Stamina.WalkSpeedOverweightLimits.x = config.walkSpeedOverWeightLimitBaseX + config.walkSpeedOverWeightLimitPerPurchaseX * healthPurchaseRecord.weightLimitIncreasePurchases;
        globals.Stamina.WalkSpeedOverweightLimits.y = config.walkSpeedOverWeightLimitBaseY + config.walkSpeedOverWeightLimitPerPurchaseY * healthPurchaseRecord.weightLimitIncreasePurchases;

        globals.Stamina.WalkOverweightLimits.x = config.walkOverWeightLimitBaseX + config.walkOverWeightLimitPerPurchaseX * healthPurchaseRecord.weightLimitIncreasePurchases;
        globals.Stamina.WalkOverweightLimits.y = config.walkOverWeightLimitBaseY + config.walkOverWeightLimitPerPurchaseY * healthPurchaseRecord.weightLimitIncreasePurchases;
        
        globals.Stamina.SprintOverweightLimits.x = config.sprintOverWeightLimitBaseX + config.sprintOverWeightLimitPerPurchaseX * healthPurchaseRecord.weightLimitIncreasePurchases;
        globals.Stamina.SprintOverweightLimits.y = config.sprintOverWeightLimitBaseY + config.sprintOverWeightLimitPerPurchaseY * healthPurchaseRecord.weightLimitIncreasePurchases;
    }

    static getHealthPurchaseRecord(pmcID: string, healthPurchaseRecord: HealthPurchases) : HealthPurchaseRecord
    {
        if (!healthPurchaseRecord[pmcID])
        {
            healthPurchaseRecord[pmcID] = [];
            healthPurchaseRecord[pmcID].push(
                { 
                    headHealthPurchases: 0,
                    chestHealthPurchases: 0,
                    stomachHealthPurchases: 0,
                    leftArmHealthPurchases: 0,
                    rightArmHealthPurchases: 0,
                    leftLegHealthPurchases: 0,
                    rightLegHealthPurchases: 0,
                    weightLimitIncreasePurchases: 0
                });
        }

        return healthPurchaseRecord[pmcID][0];
    }

    static loadHealthPurchaseHistory(validateSchema: ValidateFunction<unknown>): HealthPurchases 
    {
        try 
        {
            const data = fs.readFileSync(path.join(__dirname, healthPurchaseHistoryFile), "utf8");
            const parsedData = JSON.parse(data) as unknown; // Still needs validation.

            // Validate the JSON data
            if (!validateSchema(parsedData)) 
            {
                throw new Error(`Invalid JSON data: ${JSON.stringify(validateSchema.errors)}`);
            }

            return parsedData as HealthPurchases; // Safe cast after validation.
        } 
        catch (err) 
        {
            if (err.code === "ENOENT") 
            {
                // File not found, creating a new one
                this.saveHealthPurchaseHistory(validateSchema, {});
                return {};
            } 
            else 
            {
                // Some other error occurred
                throw new Error(`Failed to read extract history file: ${err}`);
            }
        }
    }

    static saveHealthPurchaseHistory(validateSchema: ValidateFunction<unknown>, healthPurchases: HealthPurchases): void 
    {
        try 
        {
            // Validate the JSON data
            if (!validateSchema(healthPurchases)) 
            {
                throw new Error(`Invalid JSON data: ${JSON.stringify(validateSchema.errors)}`);
            }

            const jsonStr = JSON.stringify(healthPurchases, null, 4);
            fs.writeFileSync(path.join(__dirname, healthPurchaseHistoryFile), jsonStr, "utf8");
        } 
        catch (err) 
        {
            throw new Error(`Failed to write healthpurchases to file: ${err}`);
        }
    }

    postDBLoad(container: DependencyContainer): void 
    {
        // Resolve SPT classes we'll use
        const databaseServer: DatabaseServer = container.resolve<DatabaseServer>("DatabaseServer");
        const jsonUtil: JsonUtil = container.resolve<JsonUtil>("JsonUtil");
        const hashUtil: HashUtil = container.resolve<HashUtil>("HashUtil");
        const traderHelper = new TraderHelper();
        const configServer = container.resolve<ConfigServer>("ConfigServer");
        const itemConfig = configServer.getConfig<IItemConfig>(ConfigTypes.ITEM);
        
        const fluentAssortConstructor = new FluentAssortConstructor(hashUtil, CharacterHealthTrader.logger);
        const customItemService = container.resolve<CustomItemService>("CustomItemService");
        const tables = databaseServer.getTables();
        
        // Add new trader to the trader dictionary in DatabaseServer - has no assorts (items) yet
        traderHelper.addTraderToDb(trader, tables, jsonUtil);
        
        this.createAllBands(fluentAssortConstructor, customItemService, tables, itemConfig);
        traderHelper.addTraderToLocales(trader, tables, trader.name, trader.surname, trader.nickname, trader.location, "Coach's Shop");
    }

    createAllBands(fluentAssortConstructor: FluentAssortConstructor, customItemService: CustomItemService, tables: IDatabaseTables, itemConfig: IItemConfig) 
    {
        if (config.enableHealthPurchases)
        {
            this.createHealthBand(fluentAssortConstructor, customItemService, tables, itemConfig, "Head", bandHealthID, config.headHealthPurchaseCost, bandHealthHandbookID, "a");
            this.createHealthBand(fluentAssortConstructor, customItemService, tables, itemConfig, "Chest", bandHealthID, config.chestHealthPurchaseCost, bandHealthHandbookID, "a");
            this.createHealthBand(fluentAssortConstructor, customItemService, tables, itemConfig, "Stomach", bandHealthID, config.stomachHealthPurchaseCost, bandHealthHandbookID, "a");
            this.createHealthBand(fluentAssortConstructor, customItemService, tables, itemConfig, "LeftArm", bandHealthID, config.leftArmHealthPurchaseCost, bandHealthHandbookID, "a");
            this.createHealthBand(fluentAssortConstructor, customItemService, tables, itemConfig, "RightArm", bandHealthID, config.rightArmHealthPurchaseCost, bandHealthHandbookID, "a");
            this.createHealthBand(fluentAssortConstructor, customItemService, tables, itemConfig, "LeftLeg", bandHealthID, config.leftLegHealthPurchaseCost, bandHealthHandbookID, "a");
            this.createHealthBand(fluentAssortConstructor, customItemService, tables, itemConfig, "RightLeg", bandHealthID, config.rightLegHealthPurchaseCost, bandHealthHandbookID, "a");
        }

        if (config.enableSkillExpPurchases)
        {
            this.createSkillBands(fluentAssortConstructor, customItemService, tables, itemConfig, skills.Physical, bandPhysicalID, config.skillPrice, config.skillExp, bandPhysicalHandbookID, "b");
            this.createSkillBands(fluentAssortConstructor, customItemService, tables, itemConfig, skills.Mental, bandMentalID, config.skillPrice, config.skillExp, bandMentalHandbookID, "c");
            this.createSkillBands(fluentAssortConstructor, customItemService, tables, itemConfig, skills.Practical, bandPracticalID, config.skillPrice, config.skillExp, bandPracticalHandbookID, "d");
            this.createSkillBands(fluentAssortConstructor, customItemService, tables, itemConfig, skills.Combat, bandCombatID, config.skillPrice, config.skillExp, bandCombatHandbookID, "e");
        }

        if (config.enableCharacterExpPurchase)
        {
            this.createSkillBands(fluentAssortConstructor, customItemService, tables, itemConfig, ["Character"], bandCharacterID, config.characterPrice, config.characterExp, bandCharacterHandbookID, "f");
        }

        if (config.enableWeightLimitPurchase)
        {
            this.createWeightBands(fluentAssortConstructor, customItemService, tables, itemConfig, bandWeightHandbookID, "g");
        }
    }

    createHealthBand(fluentAssortConstructor: FluentAssortConstructor, customItemService: CustomItemService,  tables: IDatabaseTables, itemConfig: IItemConfig,bodyPart: string, bandID: string, cost: number, handbookID: string, idPrefix: string)
    {
        const itemDetails : NewItemFromCloneDetails = {
            itemTplToClone: bandID,
            overrideProperties: {
                CanSellOnRagfair: false
            },
            parentId: "54009119af1c881c07000029",
            newId: idPrefix + bodyPart + bandHealthIDSuffix,
            fleaPriceRoubles: 100000,
            handbookPriceRoubles: 80000,
            handbookParentId: handbookID,
            locales: {
                "en": {
                    name: bodyPart + " Training (ONLY APPLIED AFTER A RAID OF CLIENT RESTART)" ,
                    shortName: bodyPart,
                    description: "Grants increased health to " + bodyPart + " on purchase"
                }
            }
        }
        const itemResult = customItemService.createItemFromClone(itemDetails); //Basically calls the function and tell the server to add our Cloned new item into the server

        itemConfig.blacklist.push(itemDetails.newId);
        fluentAssortConstructor.createSingleAssortItem(itemResult.itemId, bodyPart + bandHealthTradeIDSuffix)
            .addUnlimitedStackCount()
            .addMoneyCost(Money.ROUBLES, cost)
            .addLoyaltyLevel(1)
            .export(tables.traders[trader._id]);
    }

    createSkillBands(fluentAssortConstructor: FluentAssortConstructor, customItemService: CustomItemService, tables: IDatabaseTables, itemConfig: IItemConfig, skillNames, bandID: string, cost, experience: number, handbookID: string, idPrefix: string) 
    {
        for (const skillName of skillNames) 
        {
            const itemDetails : NewItemFromCloneDetails = {
                itemTplToClone: bandID,
                overrideProperties: {
                    CanSellOnRagfair: false
                },
                parentId: "54009119af1c881c07000029",
                newId: idPrefix + skillName + bandExperienceIDSuffix,
                fleaPriceRoubles: 100000,
                
                handbookPriceRoubles: 80000,
                handbookParentId: handbookID,
                locales: {
                    "en": {
                        name: skillName + " Training (" + experience + ")",
                        shortName: skillName,
                        description: "Grants " + experience + skillName + " exp on purchase"
                    }
                }
            }
            const itemResult = customItemService.createItemFromClone(itemDetails); //Basically calls the function and tell the server to add our Cloned new item into the server

            itemConfig.blacklist.push(itemDetails.newId);
            fluentAssortConstructor.createSingleAssortItem(itemResult.itemId, skillName + bandExperienceTradeIDSuffix)
                .addUnlimitedStackCount()
                .addMoneyCost(Money.ROUBLES, cost)
                .addLoyaltyLevel(1)
                .export(tables.traders[trader._id]);
        }
    }
    
    createWeightBands(fluentAssortConstructor: FluentAssortConstructor, customItemService: CustomItemService, tables: IDatabaseTables, itemConfig: IItemConfig, handbookID: string, idPrefix: string) 
    {
        const itemDetails : NewItemFromCloneDetails = {
            itemTplToClone: bandWeightID,
            overrideProperties: {
                CanSellOnRagfair: false
            },
            parentId: "54009119af1c881c07000029",
            newId: idPrefix + bandWeightIDSuffix,
            fleaPriceRoubles: 100000,
            handbookPriceRoubles: 80000,
            handbookParentId: handbookID,
            locales: {
                "en": {
                    name: "Weight Training (ONLY APPLIED AFTER A RAID OF CLIENT RESTART)",
                    shortName: "Weight Training",
                    description: "Grants increased maximum carry weight"
                }
            }
        }
        const itemResult = customItemService.createItemFromClone(itemDetails); //Basically calls the function and tell the server to add our Cloned new item into the server

        itemConfig.blacklist.push(itemDetails.newId);
        fluentAssortConstructor.createSingleAssortItem(itemResult.itemId, bandWeightTradeIDSuffix)
            .addUnlimitedStackCount()
            .addMoneyCost(Money.ROUBLES, config.weightIncreasePrice)
            .addLoyaltyLevel(1)
            .export(tables.traders[trader._id]);
    }
}

module.exports = { mod: new CharacterHealthTrader() }
