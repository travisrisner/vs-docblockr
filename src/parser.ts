/**
 * Handlers getting code string from snippet handler (`snippet.ts`), passing to
 * be lexed code string to lexer and render docblock string.
 *
 * This file is never instantiated directly, rather it is inherited by the
 * current language in use. The language instance is determined by the entry point
 * (`extension.ts`). When the snippet handler (`snippet.ts`) detects a user is
 * trying to create a docblock, the active window editor is passed to the
 * parser (`parser.ts`). The parser then selects the line of code immediately
 * below the selected position. The text below is stored and passed to the
 * lexer (`lexer.ts`). After which, it is up to current language instance of the
 * parser to parse the lexed object returned. The docblock creation is then
 * mostly handled by the parent instance of the parser.
 */

'use strict';

import { Lexed, Lexer } from './lexer';
import { Options, Settings } from './settings';

import * as vscode from 'vscode';

/**
 * Describes a function parameter
 */
export interface Param {
  /**
   * Parameter's name. Should always be present
   */
  name: string;

  /**
   * Parameter's value. Usually empty string if no parameter value is provided
   */
  val: string;

  /**
   * Parameter's data type. This is usually language specific and is not
   * required. Ex. string, integer, array, etc.
   */
  type?: string;
}

/**
 * Tokenized code returned from lexer. This defines whether lexed code was a
 * class, function of variable
 */
export interface Tokens {
  /**
   * Name of code binding/identifier
   */
  name: string;

  /**
   * What type of code it is. (class, function, variable)
   */
  type: string;

  /**
   * When `Tokens.type` is variable, this optional value refers to that
   * variables type
   */
  varType?: string;

  /**
   * Describes if there is a return value, and what type it is
   */
  return?: {
    /**
     * Indicates if there is a return value for this function
     */
    present: boolean;

    /**
     * Describes what type of return value. (Optional)
     */
    type?: string;
  };

  /**
   * List of function parameters if token is describing a function
   */
  params?: Param[];
}

/**
 * Initial Class for parsing Doc Block comments
 */
export class Parser {
  /**
   * Extensions configuration settings
   *
   * @var  {vscode.WorkspaceConfiguration}
   */
  public config: vscode.WorkspaceConfiguration;

  /**
   * Number of spaces between tag elements. Retrieved from editor configuration
   *
   * @var  {string}
   */
  public columns: string;

  /**
   * Language specific parser settings
   *
   * @var  {Settings}
   */
  public settings: Settings;

  constructor(options: Options) {
    // Get instance of language settings
    this.settings = new Settings(options);
    // Get extension configuration
    this.config = vscode.workspace.getConfiguration('vs-docblockr');
    // Get column spacing from configuration object
    const column: number = this.config.get('columnSpacing');
    // Generate spaces based on column number
    this.columns = Array(column + 1).join(' ');
  }

  /**
   * Searches lexed objects by the type property
   *
   * @param   {string}      type   Type value to search for
   * @param   {Lexed[]}     lexed  List of lexed objects
   *
   * @return  {Lexed|null}         Lexed object found, null if no result was
   *                               found
   */
  public findByType(type: string, lexed: Lexed[]): Lexed | null {
    let result = null;
    for (const i in lexed)
      if (lexed[i].type === type) {
        // It is occasionally convenient to keep up with where we were in the
        // array
        lexed[i].index = parseInt(i);
        result = lexed[i];
      }
    return result;
  }

  /**
   * Parse language tokens from code string and send tokens to docblock render
   *
   * @param   {TextDocument}  editor  The content of the editor
   *
   * @return  {string}                The rendered docblock string
   */
  public init(editor: vscode.TextEditor): string {
    const doc = editor.document;
    // Refers to user's current cursor position
    const current = vscode.window.activeTextEditor.selections[0].active;
    // Determine numerical position of line below user's current position
    // This is assumed to be the code we want to tokenize
    const nextLine = doc.lineAt(current.line + 1);
    // Prevent potential lexer issues by trimming trailing whitespace
    const nextLineTrimmed = nextLine.text.trim();
    // Attempt to get token information needed for render doc string
    const lexed = this.tokenize(nextLineTrimmed);
    return this.renderBlock(lexed);
  }

  /**
   * Lex code string provided
   *
   * @param   {string}   code  Code string to lex
   *
   * @return  {Lexed[]}        List of lexed tokens
   */
  public lex(code: string): Lexed[] {
    return new Lexer(code).getTokens();
  }

  /**
   * Checks if token from lexed object matches any grammar settings
   *
   * @param   {string}   token  Potential token name
   * @param   {string}   type   Optionally grammar type to check against
   *
   * @return  {boolean}         True if token name exists in grammar
   */
  public matchesGrammar(token: string, type: string = ''): boolean {
    // Check if token matches grammar type provided
    if (this.settings.grammar.hasOwnProperty(type)) {
      // Add special case for grammar types living in lists
      if (type === 'modifiers' || type === 'variables' || type === 'types') {
        for (const grammar of this.settings.grammar[type]) {
          if (grammar === token) {
            return true;
          }
        }
      } else
        // Check if token provided matches grammar property provided
        return this.settings.grammar[type] === token;
    }
    for (const grammar in this.settings.grammar) {
      // Check if the token being checked has a grammar setting
      if (this.settings.grammar[grammar] === token) {
        return true;
      }
    }
    return false;
  }

  /**
   * Renders docblock string based on tokenized object
   *
   * @param   {Tokens}  tokens  Tokenized docblock object
   *
   * @return  {string}          Generated docblock string
   */
  public renderBlock(tokens: Tokens): string {
    // Incremented count value for incrementing tab selection number
    let count = 1;
    // Convert string to a snippet placeholder and auto-increment the counter
    // on each call
    const placeholder = (str: string) => `\$\{${count++}:${str}\}`;
    // Handler each part of docblock, including the empty lines, as a list that
    // will be joined at the end
    let blockList: string[] = [];
    // Function description
    blockList.push(placeholder(`[${this.escape(tokens.name)} description]`));
    // Parameter tags
    blockList = this.renderParamTags(tokens, blockList, placeholder);
    // Return tag
    blockList = this.renderReturnTag(tokens, blockList, placeholder);
    // Var tag
    blockList = this.renderVarTag(tokens, blockList, placeholder);

    const eos = this.settings.eos;
    // Join together each docblock piece, use the `End of String` var in settings
    // to concatenated
    let block = this.settings.commentOpen + eos + blockList.map((blockLine) => {
      return this.settings.separator + blockLine;
    }).join(eos) + eos + this.settings.commentClose;
    // Attempt to strip out trailing whitespace
    block = block.replace(/\s$/gm, '');

    return block;
  }

  /**
   * Renders parameter tag template for docblock
   *
   * Arguments c, t, p should be assumed to be computed by `renderParamTags()`.
   * These ambiguous argument names simply to the spaces between columns.
   *
   * @param   {string}  c     Spaces computed between initial tag and param type
   * @param   {string}  type  The variable type of said parameter
   * @param   {string}  t     Spaces computed between param type and param name
   * @param   {string}  name  Parameter's name binding
   * @param   {string}  p     Spaces computed between param name and description
   * @param   {string}  desc  Describes the parameter
   *
   * @return  {string}        Rendered parameter tag
   */
  public getParamTag(
    c:    string,
    type: string,
    t:    string,
    name: string,
    p:    string,
    desc: string): string {
    return `@param${c} ${type}${t}${name}${p}${desc}`;
  }

  /**
   * Renders parameter tags for docblock
   *
   * @param   {Tokens}    tokens       Tokenized code
   * @param   {string[]}  blockList    List of docblock lines
   * @param   {Function}  placeholder  Function for snippet formatting
   *
   * @return  {string[]}               Parameter blocks appended to block
   *                                   list. Returns list pasted in if no
   *                                   parameters
   */
  public renderParamTags(
    tokens: Tokens,
    blockList: string[],
    placeholder: (str: string) => string,
  ): string[] {
    // Get column spacing from configuration object
    const column: number = this.config.get('columnSpacing');
    // Parameter tags shouldn't be needed if no parameter tokens are available,
    // or if the code is a class property or variable
    if (tokens.params.length && tokens.type !== 'variable') {
      // Empty line
      blockList.push('');
      // Iterator over list of parameters
      for (const param of tokens.params) {
        // Calculate difference in name size
        const diff = this.maxParams(tokens, 'name') - param.name.length;
        // Calculate total param name spaces
        const pSpace = Array((column + 1) + diff).join(' ');
        // Calculate parameter type column spacing. If no types were provided
        // default to 1
        const typeDiff = param.hasOwnProperty('type')
          ? this.maxParams(tokens, 'type') - param.type.length : 1;
        // Calculate type spacing
        const tSpace = Array((column) + typeDiff).join(' ');
        // Shortcut for column space
        const cSpace = this.columns;
        // Define parameter type
        let type = '';
        // Check if parameter has a type
        if (param.hasOwnProperty('type')) {
          // Get parameter type from token object
          type = placeholder(this.escape(param.type));
        } else {
          // Use param type placeholder
          type = placeholder('[type]');
        }
        // Prevent tabstop conflicts
        const name = this.escape(param.name);
        // Description shortcut
        const desc = placeholder(`[${name} description]`);
        // Append param to docblock
        blockList.push(this.getParamTag(cSpace, type, tSpace, name, pSpace,
          desc));
      }
    }
    return blockList;
  }

  /**
   * Renders return tag with return type and computed spacing
   *
   * @param   {string}  type     Type associated with return value (in docblock
   *                             not this method)
   * @param   {string}  spacing  Spacing between type and description
   * @param   {string}  desc     Return description
   *
   * @return  {string}           Rendered return tag
   */
  public getReturnTag(type: string, spacing: string, desc: string): string {
    return `@return${this.columns}${type}${spacing}${desc}`;
  }

  /**
   * Render return tag for docblock
   *
   * @param   {Tokens}    tokens       Tokenized code
   * @param   {string[]}  blockList    List of docblock lines
   * @param   {Function}  placeholder  Function for snippet formatting
   *
   * @return  {string[]}               Return block appended to block list.
   *                                   Returns list provided if variable or no
   *                                   return tag
   */
  public renderReturnTag(
    tokens: Tokens,
    blockList: string[],
    placeholder: (str: string) => string,
  ): string[] {
    // Get column spacing from configuration object
    const column: number = this.config.get('columnSpacing');
    // Determine whether or not to display the return type by default
    const defaultReturnTag: boolean = this.config.get('defaultReturnTag');
    // Check if return section should be displayed
    if (tokens.return.present && defaultReturnTag && tokens.type !== 'variable') {
      let type = '[type]';
      // Check if a return type was provided
      if (tokens.return.type) {
        type = this.escape(tokens.return.type);
      }
      // Empty line
      blockList.push('');
      // Format type to be tabable
      type = placeholder(type);
      // Get maximum param size
      const diff = this.maxParams(tokens, 'name');
      // Calculate spacing type and description based on largest parameter name
      // The arbitrary plus 3 offsets the extra spacing needed before and after
      // the parameter name
      const spacing = Array((column + 3) + diff).join(' ');
      // Format return description to be tab-able
      const desc = placeholder('[return description]');
      // Push return type
      blockList.push(this.getReturnTag(type, spacing, desc));
    }
    return blockList;
  }

  /**
   * Renders var tag with property type and computed spacing
   *
   * @param   {string}  columns  Computed spaces between tag and type
   * @param   {string}  type     Type associated with property value (in docblock
   *                             not this method)
   *
   * @return  {string}           Rendered property tag
   */
  public getVarTag(columns: string, type: string): string {
    return `@var${this.columns}${type}`;
  }

  /**
   * Render var tag for docblock
   *
   * @param   {Tokens}    tokens       Tokenized code
   * @param   {string[]}  blockList    List of docblock lines
   * @param   {Function}  placeholder  Function for snippet formatting
   *
   * @return  {string[]}               Var block appended to block list.
   *                                   Returns list provided if not a variable
   */
  public renderVarTag(
    tokens: Tokens,
    blockList: string[],
    placeholder: (str: string) => string,
  ): string[] {
    // Add special case of variable blocks
    if (tokens.type === 'variable') {
      // Empty line
      blockList.push('');
      // Format type to be tabable
      const type: string = placeholder(tokens.varType ? tokens.varType : `[type]`);
      // Var type
      blockList.push(this.getVarTag(this.columns, type));
    }
    return blockList;
  }

 /**
  * Create tokenized object based off of the output from the Pug Lexer
  *
  * @param   {string}  code    Code to lex via the bug lexer
  * @param   {string}  next    Token name from previous function instance. Used
  *                            for letting the `tokenize` method now it should
  *                            be expecting a token name
  * @param   {Tokens}  tokens  Tokens created from the previous tokenize
  *                            instance
  *
  * @return  {Tokens}          Tokens retrieved from Pug Lexer output
  */
  public tokenize(code: string, next: string = '', tokens: Tokens = null): Tokens {
    // Create empty token object if none is present
    if (tokens === null) {
      tokens = {name: '', type: '', params: [], return: { present: true }};
    }
    return tokens;
  }

  /**
   * Replaces any `$` character with `\\$`
   *
   * Prevents issues with tabstop variables in Visual Studio Code
   *
   * @param   {string}  name  String to be escaped
   *
   * @return  {string}        Properly escaped string
   */
  protected escape(name: string): string {
    return name.replace('$', '\\$');
  }

  /**
   * Finds the longest value property value of property provided
   *
   * Used for spacing out docblock segments per line
   *
   * @param   {Tokens}   tokens    Parsed tokens from code string
   * @param   {propety}  property  The token property to calculate
   *
   * @return  {number}             The longest token value of property provided
   */
  protected maxParams(tokens: Tokens, property: string): number {
    return tokens.params.map((param) => param[property].length).reduce(
      (a, b) => Math.max(a, b));
  }
}
