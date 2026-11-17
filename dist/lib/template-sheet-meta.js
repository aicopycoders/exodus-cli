export const UNIVERSAL_IDS = ["brand", "product", "script", "people", "voice", "place", "hook", "song", "finish", "mode", "output", "method", "freeze", "later"];
export const SUBROW_IDS = [
    "product.inUsePhotoUrl", "product.subject", "product.noPhotoPolicy",
    "script.path", "script.spoken", "script.level", "script.type", "script.length", "script.ad", "script.about", "script.audience", "script.offer", "script.mechanism", "script.structureKey", "script.referenceKey", "script.adaptation", "script.skeleton",
    "people.actor", "people.elements", "people.speakerCap", "people.staging", "people.ontology", "people.style", "people.wrapper", "place.terrain", "place.setup", "place.location",
    "finish.endCard", "finish.captions", "finish.cards", "finish.soundEffects", "finish.targetSeconds", "mode.pictures", "mode.audition", "output.sceneFrameCandidates", "output.model", "output.resolution", "output.aspect",
    "song.genre", "song.mood", "song.vocal", "song.instruments", "song.bpm", "song.durationSec",
    "song.source", "song.assetId", "song.rightsStatement", "song.trimStartSec", "song.trimEndSec", "song.pairs",
    "hook.line",
    "ugc.filming", "ugc.productAppearance", "ugc.hookDraftCount", "ugc.realismOn", "ugc.retentionPicks", "ugc.creativeBrief", "ugc.authoringMode", "ugc.hook", "ugc.angle", "ugc.pick", "ugc.personId", "ugc.referenceId", "ugc.matchedReferenceIds", "ugc.structure", "ugc.verbalHook", "ugc.visualHook",
    "skeleton.pronunciations", "skeleton.recurringCast", "skeleton.style", "skeleton.opener", "skeleton.matchedReferenceIds",
    "ugc.referenceIds", "skeleton.referenceId", "skeleton.referenceIds", "skeleton.structure", "skeleton.verbalHook", "skeleton.visualHook", "skeleton.referencePerson", "skeleton.referencePlace", "skeleton.referenceFilming",
    "personification.roleVoices", "personification.pronunciations", "personification.music", "personification.openingMenu", "personification.chosenOpening",
    "yapper.authorityName", "yapper.interviewerName", "yapper.interviewerDescription", "yapper.authorityVoice", "yapper.interviewerVoice",
    "yapper.approvedControls", "yapper.authoritySelection",
];
export const VALUE_LIMITS = { text: 32000, list: 64, map: 128, rows: 128, draftBytes: 96000 };
export const NUMBER_ROWS = ["hook", "script.length", "ugc.hookDraftCount", "song.bpm", "song.durationSec", "people.speakerCap", "finish.targetSeconds", "output.sceneFrameCandidates", "song.trimStartSec", "song.trimEndSec", "song.pairs"];
export const STRING_LIST_ROWS = ["ugc.realismOn", "ugc.retentionPicks", "ugc.matchedReferenceIds", "ugc.referenceIds", "skeleton.recurringCast", "skeleton.matchedReferenceIds", "skeleton.referenceIds"];
export const BOOLEAN_ROWS = ["mode.pictures", "mode.audition", "finish.cards", "finish.soundEffects", "personification.openingMenu"];
export const RAW_TEXT_ROWS = ["song.rightsStatement", "yapper.approvedControls", "yapper.authoritySelection"];
export function wireObject(value) {
    if (!value || typeof value !== "object" || Array.isArray(value))
        throw new Error("Expected a JSON object.");
    return value;
}
export function validRowValue(id, value) {
    const text = (item) => typeof item === "string" && item.length <= VALUE_LIMITS.text;
    if (RAW_TEXT_ROWS.includes(id))
        return text(value);
    if (id === "hook.line")
        return text(value);
    const strings = (item) => Array.isArray(item) && item.every(text);
    const shape = (item, required, optional) => !!item && typeof item === "object" && !Array.isArray(item) && required.every(key => Object.hasOwn(item, key)) && Object.keys(item).every(key => required.includes(key) || optional.includes(key));
    if (id === "finish.captions")
        return typeof value === "boolean" || text(value);
    if (NUMBER_ROWS.includes(id))
        return typeof value === "number" && Number.isFinite(value);
    if (BOOLEAN_ROWS.includes(id))
        return typeof value === "boolean";
    if (STRING_LIST_ROWS.includes(id))
        return strings(value);
    if (id === "people.elements" || id === "place.location")
        return Array.isArray(value) && value.length <= (id === "place.location" ? 1 : VALUE_LIMITS.list) && value.every(item => shape(item, ["handle", "elementId"], []) && text(item.handle) && text(item.elementId));
    if (id === "voice" && Array.isArray(value))
        return value.every(item => {
            if (!shape(item, ["who", "choice"], []) || !text(item.who))
                return false;
            const choice = item.choice;
            return shape(choice, ["kind"], ["voiceId", "label"]) && (choice.kind === "clear" ? Object.keys(choice).length === 1 : choice.kind === "pin" && text(choice.voiceId) && (choice.label === undefined || text(choice.label)));
        });
    if (id === "script")
        return shape(value, ["text"], ["lines"]) && text(value.text) && (value.lines === undefined || Array.isArray(value.lines) && value.lines.every(line => shape(line, ["speaker", "text"], ["stageDirection", "performanceDirection"]) && Object.values(line).every(text)));
    if (id === "finish")
        return text(value) || shape(value, [], ["captions", "broll", "music", "room"]) && Object.entries(value).every(([key, item]) => key === "captions" ? text(item) : typeof item === "boolean");
    if (id === "product")
        return shape(value, ["name"], ["productId", "photoUrl", "facts", "appearance", "url"]) && Object.values(value).every(text);
    if (id === "voice")
        return shape(value, [], ["id", "name", "provider", "description"]) && Object.values(value).every(text) && (value.provider === undefined || value.provider === "elevenlabs" || value.provider === "kie");
    if (id === "output")
        return shape(value, ["videoModel"], ["resolution", "aspect"]) && Object.values(value).every(text);
    if (id === "skeleton.pronunciations" || id === "personification.roleVoices" || id === "personification.pronunciations")
        return !!value && typeof value === "object" && !Array.isArray(value) && Object.values(value).every(text);
    if (id === "people" && value !== null && typeof value === "object" && !Array.isArray(value))
        return Object.keys(value).length <= VALUE_LIMITS.map && Object.values(value).every(text);
    if (id === "finish.endCard")
        return strings(value);
    return text(value);
}
