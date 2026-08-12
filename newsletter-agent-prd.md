## Context 

We are building an agentic project for newsletter processing. Every week, I receive many newsletters in my Gmail account, and I'm no longer able to keep up. My goal is to be able to be able to digest all of the newsletters for one week (Monday-Sunday) in one to two hours. 
## Newsletters

I've broken these newsletters down into two lists:
* List A
	* Ben's Bites (2-3 emails / wk)
	* TLDR (5 emails / wk)
	* TLDR Founders (3 emails / wk)
	* The Rundown AI (5 emails / wk)
	* Superhuman | Zain K. (7 emails / wk)
* List B
	* Latent.Space (2 emails / wk)
	* Last Week in AI (varies, ~1 email / wk)
	* Ethan Mollick (One Useful Thing) (~1 email / few weeks)
	* Product Growth | Aakash Gupta (2-3 emails / wk)
	* ByteByteGo (3-4 emails / wk)
	* Lenny's Newsletter (4-5 emails / wk)
	* Simple.ai | Dharmesh (~1 email / wk)
I've billed List A "aggregator" newsletters which provide summaries and links to other articles and resources. List B newsletters contain medium to long-form writing on a specific topic - basically an article to themself.
## Artifacts

Before describing the architecture I've designed, let me speak about a series of artifacts and entities that the agents will interact with.
#### Topic Taxonomy

First is a Topic Taxonomy. This will be a persistent artifact which describes the categories of which stories which I want to process. The taxonomy is subject to update, and I will encourage the agentic feedback processes to propose updates to it based on new types of stories it sees. Based on an "AI Notebook" that I created back when I did read through my newsletters manually, I've come up with this initial taxonomy of topics:
- News - announcements and other big things happening in AI / tech
- AI Technical Area Updates - this is composed of paradigms + tech advancements that can be sub-categorized. Below are some sub-categories I had in my AI notebook
	- Agents / Harnesses
	- Architecture
	- OpenClaw
	- Prompting / Claude Code Tips
	- AI Coding
	- New Research
- Tech Industry Trends - in my past notebook, e.g. of articles that went into this included those about AI's impact on SAAS, enterprises, tech workers, buy vs. build
- Philosophy - high level principles behind AI (like the Bitter Lesson) and deep thought pieces on the future of AI
- Personal Productivity
- Founding / Startups
- Resources / Tools - Things that I might find useful as a software developer, FDE, founder, job searcher
- Products / Features for Inspiration - interesting solutions, often those that help me picture understand an architecture, paradigm, positioning into an industry in practice. Sometimes these would just be product landing pages, other times blog posts about how a team built something
- Operations
- Product
- Companies (career-search)
#### Digest Streams

Digest Streams will be artifacts created for each batched processing of newsletters (typically Monday-Sunday of one week). These basically are documents that I can read to get a sense of what happened that week. Initially, these will be the following:
- News
- AI Technical Area Updates
- Tech Industry Trends
#### Aggregations

Aggregations are living documents that I can use as reference on an ongoing basis. These documents will be version controlled and updated as is relevant based on the week's stories. Initial list:
- AI Architecture Taxonomy
- Exciting Areas of AI to Follow
- List of Useful Tools / Resources
- List of Products / Features for Inspiration
- Major Threads of Discourse (e.g. SAASpocalypse, labor displacement, AGI)
- Best Guides
- Companies List (for career-search)
## Pipeline Architecture

I've drafted the following architecture, which is composed of a set of pipeline steps that will be conducted by agents:
1. Ingest newsletter emails using Gmail tool.
2. Identify whether newsletter is type A or B (this is deterministic based on sender mapping)
	* If Type A: segment into individual "story units" (one per article / resource link).
	* If Type B: the email content composes the whole story unit.
3. For every story unit:
	1. Based on the information at hand (article blurb provided by Type A newsletter, or content from Type B), categorize into taxonomy and determine whether story is relevant / interesting / worth reading. 
		1. If not interesting or relevant log to a "Filtered Out" list for me to review later. Also check article (based on URL) has/is being processed by another agent.
		2. If story is interesting / worth reading but doesn't fit cleanly into the taxonomy, consider whether this would be a new category to add. If worth adding, add to a "Proposals" doc for that week.
	2. If story passes checks, do the following:
		1. If Type A newsletter story, go fetch full story.
		2. Store full story (fetched for Type A, or email content for Type B) blob into database.
		3. Write medium-length summary. I'm initially thinking this could be 1-6 paragraphs depending on the story, enough to capture all the nuance. Store this summary in database.
		4. Determine if this story is relevant to digest streams and/or aggregations. If so, add to a list of stories for each digest stream / aggregation.
		5. Predict relevance / quality score. Use to recommend either reading the full story or just the summary. Also generate a confidence score to this prediction, and log if this is low.
4. Process the list digest streams list and aggregation updates - write summaries for each digest stream for that week and update aggregations as necessarily.
5. Meta analyze the process: How was this week's run? Were there decisions that it was uncertain about (filter outs, taxonomy, scores)? Are there procedural improvements I should consider?
6. Solicit Feedback
	- Review filter outs
	- Review selection of full article recommendations + medium-length summaries
	- Review digest streams and aggregator updates
	- Review potential new proposed areas to taxonomy, digest streams, and aggregators
	- Review process met-analysis
	- [Review costs]
## Stack

For the stack, I've landed on the following:
- LangGraph for orchestration with Claude Agents SDK for each individual pipeline task. Each agent will have a system prompt determined by its task, then also be provided a fresh prompt with the relevant context to its task.
- Database - Postgres (since that's what I'm most familiar with)
	- Text storage (saved articles, summaries, version controlled artifacts)
	- Process status machines (log / status of all process tasks so that failed/interrupted pipeline resumes instead of re-processes)
	- Join tables to map articles to and from taxonomy topics, digest streams, and aggregations
- File System for current version of each artifact along with intermediate artifacts created during a run (list of articles to summarize for for digest streams / aggregation updates)
- Accessible
	- Gmail
	- Web Fetch (for articles)
	- File System (for artifacts)
	- Writing to Databases (articles, summaries)
- LangFuse for traces and evals
- Our app (along with Langfuse) will be deployed locally on my machine. I will kickoff the pipeline manually and everything will be stored locally.
- I've thought about a web frontend that will provide me with access to all aspects of the architecture - articles, summaries, and artifacts (all these can have a text to speech function); synthesis of the pipeline run steps (simpler view, whereas full traces can be investigated in LangFuse); and feedback elicitation features.