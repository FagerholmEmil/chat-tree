import { useCallback, useEffect, useState, useRef } from 'react';
import {
  ReactFlow,
  useNodesState,
  useEdgesState,
  addEdge,
  Connection,
  MiniMap,
  Controls,
  Background,
  BackgroundVariant,
  Handle,
  Position,
  NodeTypes,
} from '@xyflow/react';
import ContextMenu from './context-menu';
import '@xyflow/react/dist/style.css';
import dagre from '@dagrejs/dagre';

interface Author {
    role: string;
    name: string | null;
    metadata: Record<string, any>;
}

interface Content {
    content_type: string;
    model_set_context?: string | null; // Make this optional
    repository?: string | null;         // Make this optional
    repo_summary?: string | null;       // Make this optional
    parts?: string[] | null;
}

interface MetaData {
    is_visually_hidden_from_conversation?: boolean | null;
    serialization_metadata?: Record<string, any> | null;
    request_id?: string | null;
    message_source?: string | null;
    timestamp_?: string | null;
    message_type?: string | null;
    model_slug?: string | null;
    default_model_slug?: string | null;
    parent_id?: string | null;
    model_switcher_deny?: string[];
    finish_details?: Record<string, any> | null;
    is_complete?: boolean | null;
    citations?: string[];
    content_references?: string[];
    gizmo_id?: string | null;
    kwargs?: Record<string, any> | null;
    

}

interface Message {
    id: string;
    author: Author;
    create_time: number | null;
    update_time: number | null;
    content: Content;
    status: string;
    end_turn: boolean | null;
    weight: number;
    metadata: MetaData;
    recipient: string;
    channel: string | null;
}

interface Node {
    position?: { x: number; y: number };
    id: string;
    data?: { label: string; role?: string; timestamp?: number, id?: string, hidden?: boolean};
    message: Message | null;
    parent: string | null;
    children: string[];
    type?: string;
}

interface Edge {
    id: string;
    source: string;
    target: string;
    type: string;
    animated?: boolean;
    style?: any;
}

interface Mapping {
    [key: string]: Node;
}

interface ConversationData {
    title: string;
    create_time: number;
    update_time: number;
    mapping: Mapping;
    moderation_results: any[];
    current_node: string;
    plugin_ids: string | null;
    conversation_id: string;
    conversation_template_id: string | null;
    gizmo_id: string | null;
    is_archived: boolean;
    safe_urls: string[];
    default_model_slug: string;
    conversation_origin: string | null;
    voice: string | null;
    async_status: string | null;
}

type MenuState = {
    messageId: string;
    childrenIds: string[];
    role: string;
    top: number | boolean;
    left: number | boolean;
    right: number | boolean;
    bottom: number | boolean;
  } | null;




const dagreGraph = new dagre.graphlib.Graph().setGraph({}).setDefaultEdgeLabel(() => ({}));
const nodeWidth = 300;
const nodeHeight = 120;



const CustomNode = ({ data }: { data: any }) => {   
  return (
    <div className={`px-4 py-2 shadow-lg rounded-lg border ${
      data.role === 'user' ? 'bg-blue-50 border-blue-200' : 'bg-purple-50 border-purple-200'
    } ${data.hidden ? 'grayscale' : ''}`} style={{
      width: nodeWidth,
      height: nodeHeight,
      position: 'relative',
      opacity: data.hidden ? 0.4 : 1,
      background: data.hidden ? 'repeating-linear-gradient(45deg, transparent, transparent 10px, rgba(0,0,0,0.03) 10px, rgba(0,0,0,0.03) 20px)' : undefined
    }}>
      <Handle type="target" position={Position.Top} className="w-2 h-2" />
      <div className="flex items-center">
        <div className={`w-2 h-2 rounded-full mr-2 ${
          data.role === 'user' ? 'bg-blue-400' : 'bg-purple-400'
        }`} />
        <div className="text-xs font-semibold text-gray-500 uppercase">
          {data.role}
        </div>
      </div>
      <div className="mt-2 text-sm text-gray-700" style={{ 
        wordBreak: 'break-word',
        height: '70px',
        overflowY: 'auto'
      }}>
        {data.label.length > 100 ? `${data.label.substring(0, 100)}...` : data.label}
      </div>
      {data.timestamp && (
        <div className="absolute bottom-2 left-4 text-xs text-gray-400">
          {new Date(parseFloat(data.timestamp) * 1000).toLocaleString()} 
        </div>
      )}
      <Handle type="source" position={Position.Bottom} className="w-2 h-2" />
    </div>
  );
};

const nodeTypes: NodeTypes = {
    custom: CustomNode,
  };





const ConversationTree = () => {
  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);
  const [conversationData, setConversationData] = useState<ConversationData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [menu, setMenu] = useState<MenuState>(null);
  const ref = useRef<HTMLDivElement>(null);

  const createNodesInOrder = async (conversationData: ConversationData) => {
    const mapping = conversationData.mapping;
    const newNodes = new Array<Node>();
    const newEdges = new Array<Edge>();

    const findFirstContentParent = (node: Node): Node | null => {
        // If no children, return null
        if (node.children.length === 0) return null;

        for (const childId of node.children) {
            const child = mapping[childId];
            
            // If the child has content and is a user message, return it
            if (child.message?.content?.parts?.[0] && child.message.author.role === "user") {
                return child;
            }

            // If the child has content, search for it in its children
            const foundInChild = findFirstContentParent(child);
            if (foundInChild && foundInChild.parent) {
                // Return the parent of the child that has content so we can use it as the root
                return mapping[foundInChild.parent];
            }
        }
        
        return null;
    }

    const createChildNodes = (node: Node) => {
      if (node.children.length === 0) return;

      node.children.forEach((childId) => {
        const child = mapping[childId];
        
        // Check if current child node is valid
        if (child.message?.content?.parts?.[0] &&
            child.message.author.role !== 'system' && 
            child.message.author.role !== 'tool' &&
            child.message.recipient === 'all') {

          child.parent = node.id;
          child.type = 'custom';
          const role = child.message.author.role;
          const content = child.message.content.parts[0];
          child.data = {
            label: content,
            role: role,
            timestamp: child.message.create_time ?? undefined,
            id: child.id
          };
          
          newNodes.push(child);
          newEdges.push({
            id: `${node.id}-${child.id}`,
            source: node.id,
            target: child.id,
            type: 'smoothstep',
            animated: true,
            style: { stroke: '#2196f3', strokeWidth: 2 }
          });
          
          createChildNodes(child);
        } else {
          
          child.children.forEach((grandChildId) => {
            const grandChild = mapping[grandChildId];
            const processDescendant = (descendant: Node) => {
                // if the descendant is valid
              if (descendant.message?.content?.parts?.[0] && 
                  descendant.message.author.role !== 'system' && 
                  descendant.message.author.role !== 'tool' &&
                  descendant.message.recipient === 'all') {
            
                
                descendant.parent = node.id;
                descendant.type = 'custom';
                const role = descendant.message.author.role;
                const content = descendant.message.content.parts[0];
                descendant.data = {
                  label: content,
                  role: role,
                  timestamp: descendant.message.create_time ?? undefined,
                  id: descendant.id
                };
                
                newNodes.push(descendant);
                newEdges.push({
                  id: `${node.id}-${descendant.id}`,
                  source: node.id,
                  target: descendant.id,
                  type: 'smoothstep',
                  animated: true,
                  style: { stroke: '#2196f3', strokeWidth: 2 }
                });

                  createChildNodes(descendant);
                
              } else {
                descendant.children.forEach((descId) => {
                  processDescendant(mapping[descId]);
                });
              }
            };
            processDescendant(grandChild);
          });
        }
      });
    };

    let rootNode = Object.values(mapping).find(node => !node.parent) as Node | null;
    if (!rootNode) return;

    rootNode = findFirstContentParent(rootNode);
    if (!rootNode) return;
    
    rootNode.type = 'custom';
    const role = rootNode.message!.author.role;
    const content = role !== 'system' ? rootNode.message!.content.parts![0] : 'Start of your conversation';
    rootNode.data = {
      label: content,
      role: role,
      timestamp: rootNode.message?.create_time ?? undefined
    };
    
    newNodes.push(rootNode);
    createChildNodes(rootNode);

    const checkNodes = async (nodeIds: string[]) => {
        // check if the nodes are in the DOM (to see which are currently visible to the user)
        const response = await chrome.runtime.sendMessage({
        action: "checkNodes",
        nodeIds: nodeIds 
        });
        
        if (response.success) {
        console.log('Existing nodes:', response.existingNodes);
        return response.existingNodes;
        } else {
        console.error('Error checking nodes:', response.error);
            throw new Error(response.error);
        }
    };
    const existingNodes = await checkNodes(newNodes.map(node => node.id));
    existingNodes.forEach((hidden: boolean, index: number) => {
        if (newNodes[index]) {
            newNodes[index]!.data!.hidden = hidden;
        }
    });

    newNodes.forEach((node) => {
        dagreGraph.setNode(node.id, { width: nodeWidth, height: nodeHeight });
    });

    newEdges.forEach((edge) => {
        dagreGraph.setEdge(edge.source, edge.target);
      });

    dagre.layout(dagreGraph);
     
      const newNodesWithPositions = newNodes.map((node) => {
        const nodeWithPosition = dagreGraph.node(node.id);
        const newNode = {
          ...node,
          targetPosition: 'top',
          sourcePosition: 'bottom',
          // We are shifting the dagre node position (anchor=center center) to the top left
          // so it matches the React Flow node anchor point (top left).
          position: {
            x: nodeWithPosition.x - nodeWidth / 2,
            y: nodeWithPosition.y - nodeHeight / 2,
          },
        };
     
        return newNode;
      });
     
    setNodes(newNodesWithPositions as any);
    setEdges(newEdges as any);
  };

  useEffect(() => {
    const fetchData = async () => {
        // fetch data using chrome extension api
      try {
        const response = await chrome.runtime.sendMessage({ action: "fetchConversationHistory" });
        if (response.success) {
          setConversationData(response.data);
        } else {
          console.error('Failed to fetch conversation data:', response.error);
        }
      } catch (error) {
        console.error('Error fetching conversation data:', error);
      } finally {
        setIsLoading(false);
      }
    };
    
    fetchData();

  }, []);

  useEffect(() => {
    if (conversationData) {
        
      createNodesInOrder(conversationData).then().catch();
    }
  }, [conversationData]);


  const onNodeContextMenu = useCallback(
    (event: React.MouseEvent, node: Node) => {
      // Prevent native context menu from showing
      event.preventDefault();

      // Calculate position of the context menu. We want to make sure it
      // doesn't get positioned off-screen.
      const pane = ref?.current?.getBoundingClientRect();
      const nodeId = node.data?.id ?? '';
      if (pane) {
        setMenu({
          messageId: nodeId,
          childrenIds: node.children,
          role: node.data?.role ?? '',
          top: event.clientY < pane.height - 200 && event.clientY ? event.clientY - 48 : false,
          left: event.clientX < pane.width - 200 && event.clientX ? event.clientX : false,
          right: event.clientX >= pane.width - 200 && pane.width - event.clientX,
          bottom:
            event.clientY >= pane.height - 200 && pane.height - event.clientY + 48,
        });
      } 
    },
    [setMenu],
  );

  // Close the context menu if it's open whenever the window is clicked.
  const onPaneClick = useCallback(() => setMenu(null), [setMenu]);


  const onConnect = useCallback(
    (params: Connection) => setEdges((eds) => addEdge(params, eds)),
    [setEdges],
  );

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="animate-spin rounded-full h-16 w-16 border-t-2 border-b-2 border-blue-500"></div>
      </div>
    );
  }

  if (!conversationData) {
    return (
      <div className="flex items-center justify-center h-screen text-gray-600">
        No conversation data available, please refresh the page and try again.
      </div>
    );
  }
 
  return (
    <div className="w-full h-full" style={{ height: '90vh', width: '100%' }}>
      <ReactFlow
        ref={ref}
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        nodeTypes={nodeTypes}
        onNodeContextMenu={onNodeContextMenu}
        onPaneClick={onPaneClick}
        fitView
        minZoom={0.1}
        maxZoom={1.5}
        defaultViewport={{ x: 0, y: 0, zoom: 0.8 }}
      >
        <Controls className="bg-white rounded-lg shadow-lg" />
        <MiniMap 
          nodeColor={(node) => node.data?.role === 'user' ? '#bbdefb' : '#e1bee7'}
          className="bg-white rounded-lg shadow-lg"
        />
        <Background variant={BackgroundVariant.Dots} gap={12} size={1} color="#f1f1f1" />
        {menu && <ContextMenu onClick={onPaneClick} {...menu} />}
      </ReactFlow>
    </div>
  );
}

export default ConversationTree;
